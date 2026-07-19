const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

const sessions = {};

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

// ============ START ============
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const args = ctx.message.text.split(' ');
    const user = await getUser(userId, username, firstName);

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
                ctx.telegram.sendMessage(referrer.user_id, `🎉 নতুন রেফারেল! +$0.05`);
                return ctx.reply(`👋 স্বাগতম! ${referrer.first_name || 'ইউজার'}-এর রেফারেল।\n💰 +$0.05 বোনাস!`);
            }
        }
    }

    return ctx.reply(`👋 স্বাগতম EarnFlow বটে, ${firstName || 'ইউজার'}!\n\n💰 টাস্ক করে ইনকাম করুন\n👥 রেফারেল করে বোনাস পান`, {
        reply_markup: {
            keyboard: [['📺 টাস্ক', '👥 রেফারেল'], ['💰 ব্যালেন্স', '🏧 উইথড্র'], ['🏆 লিডারবোর্ড', '📞 সাপোর্ট']],
            resize_keyboard: true
        }
    });
});

// ============ USER MENU ============
bot.hears('📺 টাস্ক', async (ctx) => {
    const { data: tasks } = await supabase.from('tasks').select('*').order('id', { ascending: true });
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');
    const buttons = tasks.map(task => {
        return [{ text: `${task.icon || '📺'} ${task.title} - $${task.reward}`, callback_data: `task_${task.id}` }];
    });
    ctx.reply('📺 টাস্ক:', { reply_markup: { inline_keyboard: buttons } });
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

// ============ TASK SYSTEM ============



bot.action(/task_(.+)/, async (ctx) => {
    const taskId = ctx.match[1];
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];

    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return ctx.answerCbQuery('টাস্ক পাওয়া যায়নি!', { show_alert: true });

    const { data: comp } = await supabase.from('task_completions').select('*').eq('user_id', userId).eq('task_id', taskId).eq('completed_at', today).single();
    const done = comp?.count_today || 0;
    const remaining = task.daily_limit - done;

    if (remaining <= 0) {
        return ctx.answerCbQuery(`⚠️ আজকের লিমিট শেষ (${task.daily_limit} বার)`, { show_alert: true });
    }

    await ctx.answerCbQuery();

    // প্রথম মেসেজ - শুধু অ্যাড বাটন
    const msg = await ctx.reply(
        `${task.icon || '📺'} **${task.title}**\n\n💰 রিওয়ার্ড: $${task.reward}\n📊 আজ বাকি: ${remaining}/${task.daily_limit}\n\n🔗 নিচের বাটনে ক্লিক করে অ্যাড দেখুন\n⏳ ১৫ সেকেন্ড পর রিওয়ার্ড নিন`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔗 অ্যাড দেখুন', url: task.ad_link }],
                    [{ text: '⏳ ১৫ সেকেন্ড অপেক্ষা করুন...', callback_data: 'countdown_start' }]
                ]
            }
        }
    );

    // Store task info for countdown
    sessions[`countdown_${msg.message_id}`] = {
        taskId: task.id,
        taskTitle: task.title,
        taskReward: task.reward,
        remaining: remaining,
        dailyLimit: task.daily_limit,
        chatId: msg.chat.id,
        messageId: msg.message_id
    };
});

// Start countdown
bot.action('countdown_start', async (ctx) => {
    const msgId = ctx.callbackQuery.message.message_id;
    const data = sessions[`countdown_${msgId}`];
    
    if (!data) {
        return ctx.answerCbQuery('⚠️ সেশন শেষ! আবার টাস্ক সিলেক্ট করুন।', { show_alert: true });
    }

    await ctx.answerCbQuery('⏳ কাউন্টডাউন শুরু...', { show_alert: true });

    // Remove old button, show countdown
    await ctx.editMessageReplyMarkup({
        inline_keyboard: [
            [{ text: '🔗 অ্যাড দেখুন', url: `https://t.me` }], // placeholder
            [{ text: '⏳ ১৫ সেকেন্ড...', callback_data: 'noop' }]
        ]
    });

    // Countdown 15 seconds
    for (let i = 14; i >= 0; i--) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            if (i > 0) {
                await ctx.telegram.editMessageText(
                    data.chatId, data.messageId, null,
                    `📺 **${data.taskTitle}**\n\n💰 রিওয়ার্ড: $${data.taskReward}\n📊 আজ বাকি: ${data.remaining}/${data.dailyLimit}\n\n⏳ **${i}** সেকেন্ড অপেক্ষা করুন...`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔗 অ্যাড দেখুন', url: `https://t.me` }],
                                [{ text: `⏳ ${i} সেকেন্ড...`, callback_data: 'noop' }]
                            ]
                        }
                    }
                );
            } else {
                await ctx.telegram.editMessageText(
                    data.chatId, data.messageId, null,
                    `📺 **${data.taskTitle}**\n\n💰 রিওয়ার্ড: $${data.taskReward}\n📊 আজ বাকি: ${data.remaining}/${data.dailyLimit}\n\n✅ এখন রিওয়ার্ড নিন!`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🎁 রিওয়ার্ড নিন', callback_data: `complete_${data.taskId}` }]
                            ]
                        }
                    }
                );
            }
        } catch(e) {}
    }

    delete sessions[`countdown_${msgId}`];
});

bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery('⏳ অপেক্ষা করুন...', { show_alert: true });
});




bot.action('waiting', async (ctx) => {
    await ctx.answerCbQuery('⏳ ১৫ সেকেন্ড অপেক্ষা করুন...', { show_alert: true });
});

bot.action(/complete_(.+)/, async (ctx) => {
    const taskId = ctx.match[1];
    const userId = ctx.from.id;
    const today = new Date().toISOString().split('T')[0];

    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (!task) return ctx.answerCbQuery('টাস্ক পাওয়া যায়নি!', { show_alert: true });

    const { data: comp } = await supabase.from('task_completions').select('*').eq('user_id', userId).eq('task_id', taskId).eq('completed_at', today).single();
    const done = comp?.count_today || 0;

    if (done >= task.daily_limit) {
        return ctx.answerCbQuery('⚠️ আজকের লিমিট শেষ!', { show_alert: true });
    }

    if (comp) {
        await supabase.from('task_completions').update({ count_today: comp.count_today + 1 }).eq('id', comp.id);
    } else {
        await supabase.from('task_completions').insert({ user_id: userId, task_id: taskId, completed_at: today, count_today: 1 });
    }

    await supabase.rpc('add_balance', { uid: userId, amount: task.reward });
    const { data: user } = await supabase.from('bot_users').select('balance').eq('user_id', userId).single();

    await ctx.answerCbQuery('✅ রিওয়ার্ড যোগ হয়েছে!', { show_alert: true });
    await ctx.deleteMessage();
    ctx.reply(`✅ টাস্ক সম্পন্ন!\n\n📺 ${task.title}\n💰 +$${task.reward}\n💵 মোট: $${user.balance.toFixed(2)}`);
});

// ============ ADMIN ============
bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('👑 প্যানেল\n/addtask | /removetask | /tasks\n/addchannel | /removechannel | /channels\n/users');
});

bot.command('addtask', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    sessions[ctx.from.id] = { action: 'addtask', step: 'title' };
    ctx.reply('📝 টাইটেল লিখুন:');
});

bot.command('removetask', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: tasks } = await supabase.from('tasks').select('id, title');
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');
    let msg = '🗑️ আইডি লিখুন:\n\n';
    tasks.forEach(t => { msg += `🆔 ${t.id}: ${t.title}\n`; });
    sessions[ctx.from.id] = { action: 'removetask', step: 'confirm' };
    ctx.reply(msg);
});

bot.command('tasks', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: tasks } = await supabase.from('tasks').select('*');
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');
    let msg = '📺 টাস্ক:\n\n';
    tasks.forEach(t => { msg += `🆔 ${t.id}: ${t.title} - $${t.reward}\n`; });
    ctx.reply(msg);
});

bot.command('addchannel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    sessions[ctx.from.id] = { action: 'addchannel', step: 'username' };
    ctx.reply('📢 ইউজারনেম (@ দিয়ে):');
});

bot.command('removechannel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: channels } = await supabase.from('channels').select('*');
    if (!channels || channels.length === 0) return ctx.reply('⚠️ কোনো চ্যানেল নেই।');
    let msg = '🗑️ আইডি লিখুন:\n\n';
    channels.forEach(ch => { msg += `🆔 ${ch.id}: ${ch.channel_name}\n`; });
    sessions[ctx.from.id] = { action: 'removechannel', step: 'confirm' };
    ctx.reply(msg);
});

bot.command('channels', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: channels } = await supabase.from('channels').select('*');
    if (!channels || channels.length === 0) return ctx.reply('⚠️ কোনো চ্যানেল নেই।');
    let msg = '📢 চ্যানেল:\n\n';
    channels.forEach(ch => { msg += `🆔 ${ch.id}: ${ch.channel_name}\n`; });
    ctx.reply(msg);
});

bot.command('users', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: users } = await supabase.from('bot_users').select('*').order('joined_at', { ascending: false }).limit(20);
    if (!users || users.length === 0) return ctx.reply('⚠️ কোনো ইউজার নেই।');
    let msg = '👥 ইউজার:\n\n';
    users.forEach(u => { msg += `🆔 ${u.user_id}: ${u.first_name||'N/A'} - $${u.balance.toFixed(2)}\n`; });
    ctx.reply(msg);
});

bot.command('cancel', async (ctx) => {
    delete sessions[ctx.from.id];
    ctx.reply('❌ বাতিল');
});

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    if (userId !== ADMIN_ID) return next();
    if (!sessions[userId]) return next();
    const session = sessions[userId];
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();

    if (session.action === 'addtask') {
        if (session.step === 'title') { session.title = text; session.step = 'reward'; return ctx.reply('💰 রিওয়ার্ড (সংখ্যা):'); }
        if (session.step === 'reward') { const r = parseFloat(text); if (isNaN(r)) return ctx.reply('❌ সংখ্যা লিখুন।'); session.reward = r; session.step = 'ad_link'; return ctx.reply('🔗 লিংক:'); }
        if (session.step === 'ad_link') { session.ad_link = text; session.step = 'daily_limit'; return ctx.reply('📊 লিমিট:'); }
        if (session.step === 'daily_limit') { const l = parseInt(text); if (isNaN(l)) return ctx.reply('❌ সংখ্যা লিখুন।'); await supabase.from('tasks').insert({ title: session.title, reward: session.reward, ad_link: session.ad_link, icon: '📺', daily_limit: l }); ctx.reply(`✅ যোগ হয়েছে!\n📺 ${session.title}\n💰 $${session.reward}\n📊 ${l}/দিন`); delete sessions[userId]; }
    }
    else if (session.action === 'removetask') { const id = parseInt(text); if (isNaN(id)) return ctx.reply('❌ আইডি লিখুন।'); await supabase.from('tasks').delete().eq('id', id); ctx.reply('✅ রিমুভ হয়েছে।'); delete sessions[userId]; }
    else if (session.action === 'addchannel') { const username = text.replace('@', ''); try { const chat = await ctx.telegram.getChat(`@${username}`); let link = `https://t.me/${username}`; try { const inv = await ctx.telegram.createChatInviteLink(chat.id); link = inv.invite_link; } catch(e) {} await supabase.from('channels').insert({ channel_id: chat.id, channel_name: chat.title, invite_link: link }); ctx.reply(`✅ যোগ হয়েছে: ${chat.title}`); } catch(e) { ctx.reply('❌ চ্যানেল পাওয়া যায়নি!'); } delete sessions[userId]; }
    else if (session.action === 'removechannel') { const id = parseInt(text); if (isNaN(id)) return ctx.reply('❌ আইডি লিখুন।'); await supabase.from('channels').delete().eq('id', id); ctx.reply('✅ রিমুভ হয়েছে।'); delete sessions[userId]; }
});

// ============ WEBHOOK ============
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); }
        catch(e) { console.error(e); res.status(200).send('OK'); }
    } else {
        res.status(200).send('EarnFlow Bot is running!');
    }
};
