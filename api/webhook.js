const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// Session for step-by-step admin actions
const sessions = {};

// ============ HELPER FUNCTIONS ============

async function getUser(userId, username, firstName) {
    const { data: user } = await supabase.from('bot_users').select('*').eq('user_id', userId).single();
    if (user) return user;

    const referCode = `REF${userId}`;
    const { data: newUser } = await supabase.from('bot_users').insert({
        user_id: userId, username: username || '', first_name: firstName || '',
        refer_code: referCode, balance: 0
    }).select().single();
    return newUser;
}

// ============ START COMMAND ============

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const args = ctx.message.text.split(' ');

    const user = await getUser(userId, username, firstName);

    // Referral handling
    if (args[1]) {
        const refCode = args[1];
        const { data: referrer } = await supabase.from('bot_users').select('*').eq('refer_code', refCode).single();

        if (referrer && referrer.user_id !== userId) {
            const { data: existingRef } = await supabase.from('referrals').select('*').eq('referred_id', userId).single();

            if (!existingRef) {
                await supabase.from('referrals').insert({ referrer_id: referrer.user_id, referred_id: userId, reward_given: 0.05 });
                await supabase.rpc('increment_refer_count', { uid: referrer.user_id });
                await supabase.rpc('add_balance', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_refer_earnings', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_balance', { uid: userId, amount: 0.05 });
                ctx.telegram.sendMessage(referrer.user_id, `🎉 নতুন রেফারেল! আপনি পেয়েছেন $0.05`);
                return ctx.reply(`👋 স্বাগতম! ${referrer.first_name || 'ইউজার'}-এর রেফারেল হিসেবে জয়েন করেছেন।\n💰 আপনি $0.05 বোনাস পেয়েছেন!`);
            }
        }
    }

    return ctx.reply(`👋 স্বাগতম EarnFlow বটে, ${firstName || 'ইউজার'}!\n\n💰 টাস্ক করে টাকা ইনকাম করুন\n👥 রেফারেল করে বোনাস পান`, {
        reply_markup: {
            keyboard: [['📺 টাস্ক', '👥 রেফারেল'], ['💰 ব্যালেন্স', '🏧 উইথড্র'], ['🏆 লিডারবোর্ড', '📞 সাপোর্ট']],
            resize_keyboard: true
        }
    });
});

// ============ USER BUTTONS ============

bot.hears('📺 টাস্ক', async (ctx) => {
    const { data: tasks } = await supabase.from('tasks').select('*').order('id', { ascending: true });
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ এখনো কোনো টাস্ক নেই।');

    const buttons = tasks.map(task => {
        const data = encodeURIComponent(JSON.stringify({ task_id: task.id, title: task.title, reward: task.reward, icon: task.icon || '📺', ad_link: task.ad_link }));
        return [{ text: `${task.icon || '📺'} ${task.title} - $${task.reward}`, web_app: { url: `${process.env.BASE_URL}/webapp/?data=${data}` } }];
    });

    ctx.reply('📺 টাস্ক করুন:', { reply_markup: { inline_keyboard: buttons } });
});

bot.hears('💰 ব্যালেন্স', async (ctx) => {
    const user = await getUser(ctx.from.id);
    ctx.reply(`💰 ব্যালেন্স\n\n💵 মোট: $${user.balance.toFixed(2)}\n👥 রেফারেল: ${user.refer_count} জন\n📊 রেফারেল আর্নিং: $${user.refer_earnings.toFixed(2)}`);
});

bot.hears('👥 রেফারেল', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${user.refer_code}`;
    ctx.reply(`👥 রেফারেল\n\n🔗 লিংক:\n\`${refLink}\`\n\n📊 রেফারেল: ${user.refer_count} জন\n💰 আর্নিং: $${user.refer_earnings.toFixed(2)}\n\nপ্রতি রেফারেলে $0.05!`, { parse_mode: 'Markdown' });
});

bot.hears('🏆 লিডারবোর্ড', async (ctx) => {
    const { data: top } = await supabase.from('bot_users').select('first_name, balance').order('balance', { ascending: false }).limit(10);
    if (!top || top.length === 0) return ctx.reply('🏆 এখনো কেউ নেই।');
    let msg = '🏆 টপ ১০\n\n';
    top.forEach((u, i) => { const m = ['🥇','🥈','🥉']; msg += `${m[i]||(i+1+'️⃣')} ${u.first_name||'ইউজার'}: $${u.balance.toFixed(2)}\n`; });
    ctx.reply(msg);
});

bot.hears('🏧 উইথড্র', (ctx) => ctx.reply('🏧 শীঘ্রই আসছে...'));
bot.hears('📞 সাপোর্ট', (ctx) => ctx.reply('📞 @admin'));

// ============ WEBAPP DATA (Task Complete) ============

bot.on('web_app_data', async (ctx) => {
    const data = JSON.parse(ctx.webAppData.data);
    if (data.action !== 'claim' || !data.task_id) return;

    const userId = ctx.from.id;
    const taskId = data.task_id;
    const today = new Date().toISOString().split('T')[0];

    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return ctx.reply('❌ টাস্ক পাওয়া যায়নি।');

    const { data: comp } = await supabase.from('task_completions').select('*').eq('user_id', userId).eq('task_id', taskId).eq('completed_at', today).single();

    if (comp && comp.count_today >= task.daily_limit) {
        return ctx.reply(`⚠️ আজকের লিমিট শেষ (${task.daily_limit} বার)`);
    }

    if (comp) {
        await supabase.from('task_completions').update({ count_today: comp.count_today + 1 }).eq('id', comp.id);
    } else {
        await supabase.from('task_completions').insert({ user_id: userId, task_id: taskId, completed_at: today, count_today: 1 });
    }

    await supabase.rpc('add_balance', { uid: userId, amount: task.reward });
    ctx.reply(`✅ টাস্ক সম্পন্ন! +$${task.reward}`);
});

// ============ ADMIN PANEL ============

bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('👑 অ্যাডমিন প্যানেল\n\n/addtask - টাস্ক যোগ\n/removetask - টাস্ক রিমুভ\n/tasks - টাস্ক লিস্ট\n/addchannel - চ্যানেল যোগ\n/removechannel - চ্যানেল রিমুভ\n/channels - চ্যানেল লিস্ট\n/users - ইউজার লিস্ট');
});

// ---------- ADD TASK (Step by Step) ----------
bot.command('addtask', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    sessions[ctx.from.id] = { action: 'addtask', step: 'title' };
    ctx.reply('📝 টাস্ক টাইটেল লিখুন:\n/cancel - বাতিল');
});

// ---------- REMOVE TASK ----------
bot.command('removetask', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: tasks } = await supabase.from('tasks').select('id, title');
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');

    let msg = '🗑️ রিমুভ করতে টাস্ক আইডি লিখুন:\n\n';
    tasks.forEach(t => { msg += `🆔 ${t.id}: ${t.title}\n`; });
    msg += '\n/cancel - বাতিল';
    
    sessions[ctx.from.id] = { action: 'removetask', step: 'confirm' };
    ctx.reply(msg);
});

// ---------- TASK LIST ----------
bot.command('tasks', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: tasks } = await supabase.from('tasks').select('*');
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');
    let msg = '📺 টাস্ক লিস্ট:\n\n';
    tasks.forEach(t => { msg += `🆔 ${t.id}: ${t.title} - $${t.reward} (${t.daily_limit}/দিন)\n🔗 ${t.ad_link}\n\n`; });
    ctx.reply(msg);
});

// ---------- ADD CHANNEL ----------
bot.command('addchannel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    sessions[ctx.from.id] = { action: 'addchannel', step: 'username' };
    ctx.reply('📢 চ্যানেল ইউজারনেম লিখুন (@ দিয়ে):\n/cancel - বাতিল');
});

// ---------- REMOVE CHANNEL ----------
bot.command('removechannel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: channels } = await supabase.from('channels').select('*');
    if (!channels || channels.length === 0) return ctx.reply('⚠️ কোনো চ্যানেল নেই।');

    let msg = '🗑️ রিমুভ করতে চ্যানেল আইডি লিখুন:\n\n';
    channels.forEach(ch => { msg += `🆔 ${ch.id}: ${ch.channel_name}\n`; });
    msg += '\n/cancel - বাতিল';

    sessions[ctx.from.id] = { action: 'removechannel', step: 'confirm' };
    ctx.reply(msg);
});

// ---------- CHANNEL LIST ----------
bot.command('channels', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: channels } = await supabase.from('channels').select('*');
    if (!channels || channels.length === 0) return ctx.reply('⚠️ কোনো চ্যানেল নেই।');
    let msg = '📢 চ্যানেল লিস্ট:\n\n';
    channels.forEach(ch => { msg += `🆔 ${ch.id}: ${ch.channel_name}\n`; });
    ctx.reply(msg);
});

// ---------- USERS LIST ----------
bot.command('users', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: users } = await supabase.from('bot_users').select('*').order('joined_at', { ascending: false }).limit(20);
    if (!users || users.length === 0) return ctx.reply('⚠️ কোনো ইউজার নেই।');
    let msg = '👥 ইউজার লিস্ট:\n\n';
    users.forEach(u => { msg += `🆔 ${u.user_id}: ${u.first_name||'N/A'} - $${u.balance.toFixed(2)}\n`; });
    ctx.reply(msg);
});

// ---------- CANCEL ----------
bot.command('cancel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    delete sessions[ctx.from.id];
    ctx.reply('❌ বাতিল করা হয়েছে।');
});

// ============ HANDLE STEP-BY-STEP INPUT ============

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return next();
    if (!sessions[userId]) return next();

    const session = sessions[userId];
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();

    // ---- ADD TASK ----
    if (session.action === 'addtask') {
        if (session.step === 'title') { session.title = text; session.step = 'reward'; return ctx.reply('💰 রিওয়ার্ড লিখুন (শুধু সংখ্যা):'); }
        if (session.step === 'reward') {
            const r = parseFloat(text); if (isNaN(r)) return ctx.reply('❌ সংখ্যা লিখুন।');
            session.reward = r; session.step = 'ad_link'; return ctx.reply('🔗 অ্যাড লিংক দিন:');
        }
        if (session.step === 'ad_link') { session.ad_link = text; session.step = 'daily_limit'; return ctx.reply('📊 ডেইলি লিমিট লিখুন:'); }
        if (session.step === 'daily_limit') {
            const l = parseInt(text); if (isNaN(l)) return ctx.reply('❌ সংখ্যা লিখুন।');
            await supabase.from('tasks').insert({ title: session.title, reward: session.reward, ad_link: session.ad_link, icon: '📺', daily_limit: l });
            ctx.reply(`✅ টাস্ক যোগ হয়েছে!\n📺 ${session.title}\n💰 $${session.reward}\n📊 ${l}/দিন`);
            delete sessions[userId];
        }
    }

    // ---- REMOVE TASK ----
    else if (session.action === 'removetask') {
        const id = parseInt(text); if (isNaN(id)) return ctx.reply('❌ আইডি লিখুন।');
        await supabase.from('tasks').delete().eq('id', id);
        ctx.reply(`✅ টাস্ক রিমুভ হয়েছে।`);
        delete sessions[userId];
    }

    // ---- ADD CHANNEL ----
    else if (session.action === 'addchannel') {
        const username = text.replace('@', '');
        try {
            const chat = await ctx.telegram.getChat(`@${username}`);
            let link = `https://t.me/${username}`;
            try { const inv = await ctx.telegram.createChatInviteLink(chat.id); link = inv.invite_link; } catch(e) {}
            
            await supabase.from('channels').insert({ channel_id: chat.id, channel_name: chat.title, invite_link: link });
            ctx.reply(`✅ চ্যানেল যোগ হয়েছে: ${chat.title}`);
        } catch(e) {
            ctx.reply('❌ চ্যানেল পাওয়া যায়নি। বটকে অ্যাডমিন বানান।');
        }
        delete sessions[userId];
    }

    // ---- REMOVE CHANNEL ----
    else if (session.action === 'removechannel') {
        const id = parseInt(text); if (isNaN(id)) return ctx.reply('❌ আইডি লিখুন।');
        await supabase.from('channels').delete().eq('id', id);
        ctx.reply(`✅ চ্যানেল রিমুভ হয়েছে।`);
        delete sessions[userId];
    }
});

// ============ WEBHOOK HANDLER ============

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const { action, user_id } = req.query;

        if (action === 'get_channels') {
            const { data: channels } = await supabase.from('channels').select('channel_id, channel_name, invite_link');
            return res.status(200).json({ channels: channels || [] });
        }

        if (action === 'check_join' && user_id) {


// Get user info
if (action === 'get_user' && user_id) {
    const { data: user } = await supabase.from('bot_users').select('balance').eq('user_id', user_id).single();
    return res.status(200).json({ balance: user?.balance || 0 });
}

// Get task remaining
if (action === 'task_remaining' && user_id && req.query.task_id) {
    const taskId = req.query.task_id;
    const today = new Date().toISOString().split('T')[0];

    const { data: task } = await supabase.from('tasks').select('daily_limit').eq('id', taskId).single();
    const dailyLimit = task?.daily_limit || 10;

    const { data: comp } = await supabase
        .from('task_completions')
        .select('count_today')
        .eq('user_id', user_id)
        .eq('task_id', taskId)
        .eq('completed_at', today)
        .single();

    const done = comp?.count_today || 0;
    return res.status(200).json({ remaining: dailyLimit - done, daily_limit: dailyLimit });
}

            
            const { data: channels } = await supabase.from('channels').select('*');
            if (!channels || channels.length === 0) return res.status(200).json({ joined: true });

            for (const channel of channels) {
                try {
                    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${channel.channel_id}&user_id=${user_id}`);
                    const j = await r.json();
                    if (!j.ok || ['left','kicked'].includes(j.result?.status)) return res.status(200).json({ joined: false });
                } catch(e) { return res.status(200).json({ joined: false }); }
            }
            return res.status(200).json({ joined: true });
        }

        return res.status(200).send('EarnFlow Bot is running!');
    }



    
    if (req.method === 'POST') {
    // Check if it's a custom API call from Mini App
    if (req.body.action === 'claim_task') {
        const { user_id, task_id } = req.body;
        const today = new Date().toISOString().split('T')[0];

        // Get task
        const { data: task } = await supabase.from('tasks').select('*').eq('id', task_id).single();
        if (!task) return res.status(200).json({ success: false, message: 'টাস্ক পাওয়া যায়নি।' });

        // Check daily limit
        const { data: comp } = await supabase
            .from('task_completions')
            .select('*')
            .eq('user_id', user_id)
            .eq('task_id', task_id)
            .eq('completed_at', today)
            .single();

        if (comp && comp.count_today >= task.daily_limit) {
            return res.status(200).json({ success: false, message: `আজকের লিমিট শেষ (${task.daily_limit} বার)` });
        }

        // Update task completion
        if (comp) {
            await supabase.from('task_completions').update({ count_today: comp.count_today + 1 }).eq('id', comp.id);
        } else {
            await supabase.from('task_completions').insert({ user_id, task_id, completed_at: today, count_today: 1 });
        }

        // Add balance
        await supabase.rpc('add_balance', { uid: user_id, amount: task.reward });

        // Get new balance
        const { data: user } = await supabase.from('bot_users').select('balance').eq('user_id', user_id).single();

        return res.status(200).json({ 
            success: true, 
            reward: task.reward, 
            new_balance: user?.balance || 0 
        });
    }

    // Normal Telegram update
    try { await bot.handleUpdate(req.body, res); }
    catch(e) { console.error(e); res.status(200).send('OK'); }
    }

    
};
