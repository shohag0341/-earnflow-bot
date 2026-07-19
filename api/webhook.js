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

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const args = ctx.message.text.split(' ');
    const user = await getUser(userId, ctx.from.username, ctx.from.first_name);

    if (args[1]) {
        const { data: referrer } = await supabase.from('bot_users').select('*').eq('refer_code', args[1]).single();
        if (referrer && referrer.user_id !== userId) {
            const { data: ref } = await supabase.from('referrals').select('*').eq('referred_id', userId).single();
            if (!ref) {
                await supabase.from('referrals').insert({ referrer_id: referrer.user_id, referred_id: userId, reward_given: 0.05 });
                await supabase.rpc('increment_refer_count', { uid: referrer.user_id });
                await supabase.rpc('add_balance', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_refer_earnings', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_balance', { uid: userId, amount: 0.05 });
                ctx.telegram.sendMessage(referrer.user_id, '🎉 নতুন রেফারেল! +$0.05');
                return ctx.reply(`👋 স্বাগতম! ${referrer.first_name || 'ইউজার'}-এর রেফারেল।\n💰 +$0.05 বোনাস!`);
            }
        }
    }

    return ctx.reply(`👋 স্বাগতম EarnFlow বটে, ${ctx.from.first_name || 'ইউজার'}!\n\n💰 টাস্ক করে ইনকাম করুন\n👥 রেফারেল করে বোনাস পান`, {
        reply_markup: {
            keyboard: [['📺 টাস্ক', '👥 রেফারেল'], ['💰 ব্যালেন্স', '🏧 উইথড্র'], ['🏆 লিডারবোর্ড', '📞 সাপোর্ট']],
            resize_keyboard: true
        }
    });
});

bot.hears('📺 টাস্ক', async (ctx) => {
    const { data: tasks } = await supabase.from('tasks').select('*').order('id', { ascending: true });
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');
    const buttons = tasks.map(task => {
        const d = encodeURIComponent(JSON.stringify({ task_id: task.id, title: task.title, reward: task.reward, icon: task.icon || '📺', ad_link: task.ad_link }));
        return [{ text: `${task.icon || '📺'} ${task.title} - $${task.reward}`, web_app: { url: `${process.env.BASE_URL}/webapp/?data=${d}` } }];
    });
    ctx.reply('📺 টাস্ক:', { reply_markup: { inline_keyboard: buttons } });
});

bot.hears('💰 ব্যালেন্স', async (ctx) => {
    const user = await getUser(ctx.from.id);
    ctx.reply(`💰 ব্যালেন্স\n\n💵 মোট: $${user.balance.toFixed(2)}\n👥 রেফারেল: ${user.refer_count} জন`);
});

bot.hears('👥 রেফারেল', async (ctx) => {
    const user = await getUser(ctx.from.id);
    ctx.reply(`👥 রেফারেল\n\n🔗 লিংক:\n\`https://t.me/${ctx.botInfo.username}?start=${user.refer_code}\`\n\n📊 রেফারেল: ${user.refer_count} জন\n💰 আর্নিং: $${user.refer_earnings.toFixed(2)}`, { parse_mode: 'Markdown' });
});

bot.hears('🏆 লিডারবোর্ড', async (ctx) => {
    const { data: top } = await supabase.from('bot_users').select('first_name, balance').order('balance', { ascending: false }).limit(10);
    if (!top || top.length === 0) return ctx.reply('🏆 এখনো কেউ নেই।');
    let msg = '🏆 টপ ১০\n\n';
    top.forEach((u, i) => { msg += `${['🥇','🥈','🥉'][i] || (i+1)+'️⃣'} ${u.first_name||'ইউজার'}: $${u.balance.toFixed(2)}\n`; });
    ctx.reply(msg);
});

bot.hears('🏧 উইথড্র', (ctx) => ctx.reply('🏧 শীঘ্রই আসছে...'));
bot.hears('📞 সাপোর্ট', (ctx) => ctx.reply('📞 @admin'));

// Admin commands
bot.command('admin', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; ctx.reply('👑 /addtask /removetask /tasks /addchannel /removechannel /channels /users'); });
bot.command('addtask', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; sessions[ctx.from.id] = { action: 'addtask', step: 'title' }; ctx.reply('📝 টাইটেল:'); });
bot.command('removetask', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: t } = await supabase.from('tasks').select('id,title'); if (!t?.length) return ctx.reply('⚠️ নেই'); ctx.reply('🗑️ আইডি:\n'+t.map(x=>`🆔 ${x.id}: ${x.title}`).join('\n')); sessions[ctx.from.id]={action:'removetask',step:'confirm'}; });
bot.command('tasks', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: t } = await supabase.from('tasks').select('*'); if (!t?.length) return ctx.reply('⚠️ নেই'); ctx.reply('📺\n'+t.map(x=>`🆔 ${x.id}: ${x.title} - $${x.reward}`).join('\n')); });
bot.command('addchannel', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; sessions[ctx.from.id] = { action: 'addchannel', step: 'username' }; ctx.reply('📢 @username:'); });
bot.command('removechannel', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: c } = await supabase.from('channels').select('*'); if (!c?.length) return ctx.reply('⚠️ নেই'); ctx.reply('🗑️ আইডি:\n'+c.map(x=>`🆔 ${x.id}: ${x.channel_name}`).join('\n')); sessions[ctx.from.id]={action:'removechannel',step:'confirm'}; });
bot.command('channels', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: c } = await supabase.from('channels').select('*'); if (!c?.length) return ctx.reply('⚠️ নেই'); ctx.reply('📢\n'+c.map(x=>`🆔 ${x.id}: ${x.channel_name}`).join('\n')); });
bot.command('users', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: u } = await supabase.from('bot_users').select('*').order('joined_at',{ascending:false}).limit(20); if (!u?.length) return ctx.reply('⚠️ নেই'); ctx.reply('👥\n'+u.map(x=>`🆔 ${x.user_id}: ${x.first_name||'N/A'} - $${x.balance.toFixed(2)}`).join('\n')); });
bot.command('cancel', async (ctx) => { delete sessions[ctx.from.id]; ctx.reply('❌ বাতিল'); });

bot.on('text', async (ctx, next) => {
    const uid = ctx.from.id;
    if (uid !== ADMIN_ID || !sessions[uid]) return next();
    const s = sessions[uid], t = ctx.message.text;
    if (t.startsWith('/')) return next();
    if (s.action === 'addtask') {
        if (s.step === 'title') { s.title = t; s.step = 'reward'; return ctx.reply('💰 রিওয়ার্ড:'); }
        if (s.step === 'reward') { const r = parseFloat(t); if (isNaN(r)) return ctx.reply('❌ সংখ্যা'); s.reward = r; s.step = 'ad_link'; return ctx.reply('🔗 লিংক:'); }
        if (s.step === 'ad_link') { s.ad_link = t; s.step = 'daily_limit'; return ctx.reply('📊 লিমিট:'); }
        if (s.step === 'daily_limit') { const l = parseInt(t); if (isNaN(l)) return ctx.reply('❌ সংখ্যা'); await supabase.from('tasks').insert({title:s.title,reward:s.reward,ad_link:s.ad_link,icon:'📺',daily_limit:l}); ctx.reply(`✅ ${s.title} - $${s.reward}`); delete sessions[uid]; }
    } else if (s.action === 'removetask') { await supabase.from('tasks').delete().eq('id',parseInt(t)); ctx.reply('✅'); delete sessions[uid]; }
    else if (s.action === 'addchannel') { const un = t.replace('@',''); try { const ch = await ctx.telegram.getChat(`@${un}`); let lk = `https://t.me/${un}`; try { lk = (await ctx.telegram.createChatInviteLink(ch.id)).invite_link; } catch(e){} await supabase.from('channels').insert({channel_id:ch.id,channel_name:ch.title,invite_link:lk}); ctx.reply(`✅ ${ch.title}`); } catch(e) { ctx.reply('❌'); } delete sessions[uid]; }
    else if (s.action === 'removechannel') { await supabase.from('channels').delete().eq('id',parseInt(t)); ctx.reply('✅'); delete sessions[uid]; }
});

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const { action, user_id, task_id } = req.query;
        if (action === 'get_channels') { const { data } = await supabase.from('channels').select('channel_id,channel_name,invite_link'); return res.json({ channels: data || [] }); }
        if (action === 'check_join' && user_id) { const { data: ch } = await supabase.from('channels').select('*'); if (!ch?.length) return res.json({ joined: true }); for (const c of ch) { try { const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${c.channel_id}&user_id=${user_id}`); const j = await r.json(); if (!j.ok || ['left','kicked'].includes(j.result?.status)) return res.json({ joined: false }); } catch(e) { return res.json({ joined: false }); } } return res.json({ joined: true }); }
        if (action === 'get_user' && user_id) { const { data: u } = await supabase.from('bot_users').select('balance').eq('user_id',user_id).single(); return res.json({ balance: u?.balance || 0 }); }
        if (action === 'task_remaining' && user_id && task_id) { const td = new Date().toISOString().split('T')[0]; const { data: tk } = await supabase.from('tasks').select('daily_limit').eq('id',task_id).single(); const lim = tk?.daily_limit || 10; const { data: cp } = await supabase.from('task_completions').select('count_today').eq('user_id',user_id).eq('task_id',task_id).eq('completed_at',td).single(); const done = cp?.count_today || 0; return res.json({ remaining: lim - done, daily_limit: lim }); }
        return res.send('OK');
    }
    if (req.method === 'POST') {
        if (req.body?.action === 'claim_task') {
            const { user_id, task_id } = req.body;
            const td = new Date().toISOString().split('T')[0];
            const { data: tk } = await supabase.from('tasks').select('*').eq('id',task_id).single();
            if (!tk) return res.json({ success: false, message: 'টাস্ক নেই' });
            const { data: cp } = await supabase.from('task_completions').select('*').eq('user_id',user_id).eq('task_id',task_id).eq('completed_at',td).single();
            if (cp && cp.count_today >= tk.daily_limit) return res.json({ success: false, message: 'লিমিট শেষ' });
            if (cp) await supabase.from('task_completions').update({ count_today: cp.count_today + 1 }).eq('id',cp.id);
            else await supabase.from('task_completions').insert({ user_id, task_id, completed_at: td, count_today: 1 });
            await supabase.rpc('add_balance', { uid: user_id, amount: tk.reward });
            const { data: u } = await supabase.from('bot_users').select('balance').eq('user_id',user_id).single();
            return res.json({ success: true, reward: tk.reward, new_balance: u.balance });
        }
        try { await bot.handleUpdate(req.body, res); } catch(e) { res.send('OK'); }
    }
};
