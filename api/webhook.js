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

async function getSetting(key) {
    const { data } = await supabase.from('settings').select('value').eq('key', key).single();
    return data?.value || '0';
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
                const reward = parseFloat(await getSetting('refer_reward'));
                await supabase.from('referrals').insert({ referrer_id: referrer.user_id, referred_id: userId, reward_given: reward });
                await supabase.rpc('increment_refer_count', { uid: referrer.user_id });
                await supabase.rpc('add_balance', { uid: referrer.user_id, amount: reward });
                await supabase.rpc('add_refer_earnings', { uid: referrer.user_id, amount: reward });
                await supabase.rpc('add_balance', { uid: userId, amount: reward });
                ctx.telegram.sendMessage(referrer.user_id, `🎉 নতুন রেফারেল! +$${reward}`);
                return ctx.reply(`👋 স্বাগতম! ${referrer.first_name || 'ইউজার'}-এর রেফারেল।\n💰 +$${reward} বোনাস!`);
            }
        }
    }

    return ctx.reply(`👋 স্বাগতম EarnFlow বটে, ${ctx.from.first_name || 'ইউজার'}!\n\n💰 টাস্ক করে ইনকাম করুন\n👥 রেফারেল করে বোনাস পান`, {
        reply_markup: {
            keyboard: [['📺 টাস্ক', '👥 রেফারেল'], ['💰 ব্যালেন্স', '💳 ডিপোজিট'], ['🏧 উইথড্র', '🏆 লিডারবোর্ড'], ['📞 সাপোর্ট']],
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

bot.hears('📞 সাপোর্ট', (ctx) => ctx.reply('📞 @admin'));

// ============ DEPOSIT ============
bot.hears('💳 ডিপোজিট', async (ctx) => {
    const { data: packages } = await supabase.from('packages').select('*').eq('is_active', true);
    if (!packages || packages.length === 0) return ctx.reply('⚠️ কোনো প্যাকেজ নেই।');
    const buttons = packages.map(pkg => {
        return [{ text: `💎 ${pkg.name} - $${pkg.price}`, callback_data: `dep_${pkg.id}` }];
    });
    ctx.reply('💳 প্যাকেজ সিলেক্ট করুন:', { reply_markup: { inline_keyboard: buttons } });
});

bot.action(/dep_(.+)/, async (ctx) => {
    const pkgId = ctx.match[1];
    const { data: pkg } = await supabase.from('packages').select('*').eq('id', pkgId).single();
    if (!pkg) return ctx.answerCbQuery('পাওয়া যায়নি!');
    await ctx.answerCbQuery();
    sessions[ctx.from.id] = { action: 'deposit', step: 'method', amount: pkg.price, pkgId: pkgId };
    ctx.reply(`💳 **${pkg.name}** - $${pkg.price}\n\nপেমেন্ট মেথড:`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Bkash', callback_data: 'dmet_bkash' }],
                [{ text: 'Nagad', callback_data: 'dmet_nagad' }],
                [{ text: 'Rocket', callback_data: 'dmet_rocket' }],
                [{ text: 'Binance', callback_data: 'dmet_binance' }]
            ]
        }
    });
});

bot.action(/dmet_(.+)/, async (ctx) => {
    if (!sessions[ctx.from.id]) return ctx.answerCbQuery('⚠️ আগে প্যাকেজ সিলেক্ট করুন!');
    sessions[ctx.from.id].method = ctx.match[1];
    sessions[ctx.from.id].step = 'txid';
    await ctx.answerCbQuery();
    ctx.reply(`📱 **${ctx.match[1].toUpperCase()}**-এ $${sessions[ctx.from.id].amount} সেন্ড করে TXN ID লিখুন:\n/cancel`);
});

// ============ WITHDRAW ============
bot.hears('🏧 উইথড্র', async (ctx) => {
    const min = parseFloat(await getSetting('min_withdraw'));
    const user = await getUser(ctx.from.id);
    if (user.balance < min) return ctx.reply(`⚠️ মিনিমাম $${min}\nআপনার ব্যালেন্স: $${user.balance.toFixed(2)}`);
    
    sessions[ctx.from.id] = { action: 'withdraw', step: 'amount', max: user.balance };
    ctx.reply(`🏧 উইথড্র\n\n💰 ম্যাক্স: $${user.balance.toFixed(2)}\n📝 পরিমাণ লিখুন (সর্বোচ্চ $${user.balance.toFixed(2)}):\n/cancel`);
});

// ============ ADMIN ============
bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('👑\n/addtask /removetask /tasks\n/addchannel /removechannel /channels\n/addpackage /users /pendings\n/setref /setminwd');
});

bot.command('addtask', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; sessions[ctx.from.id] = { action: 'addtask', step: 'title' }; ctx.reply('📝 টাইটেল:'); });
bot.command('removetask', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: t } = await supabase.from('tasks').select('id,title'); if (!t?.length) return ctx.reply('⚠️ নেই'); ctx.reply('🗑️\n'+t.map(x=>`🆔 ${x.id}: ${x.title}`).join('\n')); sessions[ctx.from.id]={action:'removetask',step:'confirm'}; });
bot.command('tasks', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: t } = await supabase.from('tasks').select('*'); if (!t?.length) return ctx.reply('⚠️ নেই'); ctx.reply('📺\n'+t.map(x=>`🆔 ${x.id}: ${x.title} - $${x.reward}`).join('\n')); });
bot.command('addchannel', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; sessions[ctx.from.id] = { action: 'addchannel', step: 'username' }; ctx.reply('📢 @:'); });
bot.command('removechannel', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: c } = await supabase.from('channels').select('*'); if (!c?.length) return ctx.reply('⚠️ নেই'); ctx.reply('🗑️\n'+c.map(x=>`🆔 ${x.id}: ${x.channel_name}`).join('\n')); sessions[ctx.from.id]={action:'removechannel',step:'confirm'}; });
bot.command('channels', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: c } = await supabase.from('channels').select('*'); if (!c?.length) return ctx.reply('⚠️ নেই'); ctx.reply('📢\n'+c.map(x=>`🆔 ${x.id}: ${x.channel_name}`).join('\n')); });
bot.command('users', async (ctx) => { if (ctx.from.id !== ADMIN_ID) return; const { data: u } = await supabase.from('bot_users').select('*').order('joined_at',{ascending:false}).limit(20); if (!u?.length) return ctx.reply('⚠️ নেই'); ctx.reply('👥\n'+u.map(x=>`🆔 ${x.user_id}: ${x.first_name||'N/A'} - $${x.balance.toFixed(2)}`).join('\n')); });
bot.command('cancel', async (ctx) => { delete sessions[ctx.from.id]; ctx.reply('❌'); });

bot.command('setref', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const v = parseFloat(ctx.message.text.split(' ')[1]);
    if (!v) return ctx.reply('⚠️ /setref 0.05');
    await supabase.from('settings').upsert({ key: 'refer_reward', value: v.toString() }, { onConflict: 'key' });
    ctx.reply(`✅ রেফারেল: $${v}`);
});

bot.command('setminwd', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const v = parseFloat(ctx.message.text.split(' ')[1]);
    if (!v) return ctx.reply('⚠️ /setminwd 5');
    await supabase.from('settings').upsert({ key: 'min_withdraw', value: v.toString() }, { onConflict: 'key' });
    ctx.reply(`✅ মিন উইথড্র: $${v}`);
});

bot.command('addpackage', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const args = ctx.message.text.replace('/addpackage ', '').split('|');
    if (args.length < 2) return ctx.reply('⚠️ /addpackage নাম | মূল্য');
    await supabase.from('packages').insert({ name: args[0].trim(), price: parseFloat(args[1].trim()), description: args[2]?.trim() || '' });
    ctx.reply('✅ প্যাকেজ যোগ হয়েছে।');
});

bot.command('pendings', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: w } = await supabase.from('withdrawals').select('*').eq('status', 'pending');
    if (w?.length) {
        for (const wd of w) {
            ctx.reply(`🏧 #${wd.id}\n👤 ${wd.user_id}\n💰 $${wd.amount}\n📱 ${wd.method}: \`${wd.account_number}\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[
                    { text: '✅ Approve', callback_data: `wapp_${wd.id}` },
                    { text: '❌ Reject', callback_data: `wrej_${wd.id}` }
                ]]}
            });
        }
    }
    const { data: d } = await supabase.from('deposits').select('*').eq('status', 'pending');
    if (d?.length) {
        for (const dp of d) {
            ctx.reply(`💳 #${dp.id}\n👤 ${dp.user_id}\n💰 $${dp.amount}\n📱 ${dp.method}\nTXN: \`${dp.transaction_id}\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[
                    { text: '✅ Approve', callback_data: `dapp_${dp.id}` },
                    { text: '❌ Reject', callback_data: `drej_${dp.id}` }
                ]]}
            });
        }
    }
    if ((!w?.length) && (!d?.length)) ctx.reply('⚠️ পেন্ডিং নেই।');
});

bot.action(/wapp_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const id = ctx.match[1];
    const { data: w } = await supabase.from('withdrawals').select('*').eq('id', id).single();
    if (!w) return ctx.answerCbQuery('না');
    await supabase.from('withdrawals').update({ status: 'approved' }).eq('id', id);
    ctx.telegram.sendMessage(w.user_id, '✅ আপনার উইথড্র অ্যাপ্রুভ হয়েছে!');
    await ctx.answerCbQuery('✅'); await ctx.deleteMessage();
});

bot.action(/wrej_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const id = ctx.match[1];
    const { data: w } = await supabase.from('withdrawals').select('*').eq('id', id).single();
    if (!w) return ctx.answerCbQuery('না');
    
    sessions[ctx.from.id] = { action: 'reject_reason', withdrawId: id, userId: w.user_id, amount: w.amount };
    await ctx.answerCbQuery();
    ctx.reply('❌ রিজেক্টের কারণ লিখুন:');
});

bot.action(/dapp_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const id = ctx.match[1];
    const { data: d } = await supabase.from('deposits').select('*').eq('id', id).single();
    if (!d) return ctx.answerCbQuery('না');
    await supabase.from('deposits').update({ status: 'approved' }).eq('id', id);
    await supabase.rpc('add_balance', { uid: d.user_id, amount: d.amount });
    ctx.telegram.sendMessage(d.user_id, '✅ ডিপোজিট অ্যাপ্রুভ! ব্যালেন্স যোগ হয়েছে।');
    await ctx.answerCbQuery('✅'); await ctx.deleteMessage();
});

bot.action(/drej_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const id = ctx.match[1];
    const { data: d } = await supabase.from('deposits').select('*').eq('id', id).single();
    if (!d) return ctx.answerCbQuery('না');
    await supabase.from('deposits').update({ status: 'rejected' }).eq('id', id);
    ctx.telegram.sendMessage(d.user_id, '❌ ডিপোজিট রিজেক্ট।');
    await ctx.answerCbQuery('✅'); await ctx.deleteMessage();
});

bot.on('text', async (ctx, next) => {
    const uid = ctx.from.id;
    if (!sessions[uid]) return next();
    const s = sessions[uid], t = ctx.message.text;
    if (t.startsWith('/')) return next();

    if (s.action === 'addtask') {
        if (s.step === 'title') { s.title = t; s.step = 'reward'; return ctx.reply('💰:'); }
        if (s.step === 'reward') { const r = parseFloat(t); if (isNaN(r)) return ctx.reply('❌'); s.reward = r; s.step = 'ad_link'; return ctx.reply('🔗:'); }
        if (s.step === 'ad_link') { s.ad_link = t; s.step = 'daily_limit'; return ctx.reply('📊:'); }
        if (s.step === 'daily_limit') { const l = parseInt(t); if (isNaN(l)) return ctx.reply('❌'); await supabase.from('tasks').insert({title:s.title,reward:s.reward,ad_link:s.ad_link,icon:'📺',daily_limit:l}); ctx.reply(`✅ ${s.title} - $${s.reward}`); delete sessions[uid]; }
    } else if (s.action === 'removetask') { await supabase.from('tasks').delete().eq('id',parseInt(t)); ctx.reply('✅'); delete sessions[uid]; }
    else if (s.action === 'addchannel') { const un = t.replace('@',''); try { const ch = await ctx.telegram.getChat(`@${un}`); let lk = `https://t.me/${un}`; try { lk = (await ctx.telegram.createChatInviteLink(ch.id)).invite_link; } catch(e){} await supabase.from('channels').insert({channel_id:ch.id,channel_name:ch.title,invite_link:lk}); ctx.reply(`✅ ${ch.title}`); } catch(e) { ctx.reply('❌'); } delete sessions[uid]; }
    else if (s.action === 'removechannel') { await supabase.from('channels').delete().eq('id',parseInt(t)); ctx.reply('✅'); delete sessions[uid]; }
    else if (s.action === 'deposit' && s.step === 'txid') {
        await supabase.from('deposits').insert({ user_id: uid, amount: s.amount, method: s.method, transaction_id: t, status: 'pending' });
        ctx.reply(`✅ জমা!\n💰 $${s.amount}\n📱 ${s.method}\nTXN: \`${t}\``, { parse_mode: 'Markdown' });
        ctx.telegram.sendMessage(ADMIN_ID, `🔔 ডিপোজিট\n👤 ${uid}\n💰 $${s.amount}\n📱 ${s.method}\nTXN: \`${t}\``, { parse_mode: 'Markdown' });
        delete sessions[uid];
    }
    else if (s.action === 'withdraw' && s.step === 'amount') {
        const amt = parseFloat(t);
        if (isNaN(amt) || amt <= 0) return ctx.reply('❌ সঠিক পরিমাণ লিখুন।');
        if (amt > s.max) return ctx.reply(`⚠️ সর্বোচ্চ $${s.max.toFixed(2)}`);
        const min = parseFloat(await getSetting('min_withdraw'));
        if (amt < min) return ctx.reply(`⚠️ মিনিমাম $${min}`);
        
        s.amount = amt;
        s.step = 'method';
        ctx.reply('🏧 পেমেন্ট মেথড:', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Bkash', callback_data: 'wmet_bkash' }],
                    [{ text: 'Nagad', callback_data: 'wmet_nagad' }],
                    [{ text: 'Rocket', callback_data: 'wmet_rocket' }],
                    [{ text: 'Binance (BSC)', callback_data: 'wmet_binance' }]
                ]
            }
        });
    }
    else if (s.action === 'withdraw' && s.step === 'number') {
        const addr = t.trim();
        await supabase.from('withdrawals').insert({ user_id: uid, amount: s.amount, method: s.method, account_number: addr, status: 'pending' });
        await supabase.rpc('add_balance', { uid: uid, amount: -s.amount });
        ctx.reply(`✅ উইথড্র!\n💰 $${s.amount}\n📱 ${s.method}: \`${addr}\``, { parse_mode: 'Markdown' });
        ctx.telegram.sendMessage(ADMIN_ID, `🔔 উইথড্র\n👤 ${uid}\n💰 $${s.amount}\n📱 ${s.method}: \`${addr}\``, { parse_mode: 'Markdown' });
        delete sessions[uid];
    }
    else if (s.action === 'reject_reason') {
        const reason = t;
        await supabase.from('withdrawals').update({ status: 'rejected', admin_note: reason }).eq('id', s.withdrawId);
        await supabase.rpc('add_balance', { uid: s.userId, amount: s.amount });
        ctx.telegram.sendMessage(s.userId, `❌ উইথড্র রিজেক্ট\n💰 $${s.amount} ফেরত\n📝 কারণ: ${reason}`);
        ctx.reply('✅ রিজেক্ট + টাকা ফেরত + নোটিফিকেশন পাঠানো হয়েছে।');
        delete sessions[uid];
    }
});

bot.action(/wmet_(.+)/, async (ctx) => {
    const method = ctx.match[1];
    if (!sessions[ctx.from.id]) return ctx.answerCbQuery('⚠️');
    sessions[ctx.from.id].method = method;
    sessions[ctx.from.id].step = 'number';
    await ctx.answerCbQuery();
    if (method === 'binance') {
        ctx.reply('🔗 BSC Wallet Address লিখুন (0x...):\n/cancel\n\n⚠️ BEP-20 নেটওয়ার্ক ব্যবহার করুন।');
    } else {
        ctx.reply(`📱 ${method.toUpperCase()} নাম্বার লিখুন:\n/cancel\n\n\`ক্লিক করলেই কপি হবে\``, { parse_mode: 'Markdown' });
    }
});

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const { action, user_id, task_id } = req.query;
        if (action === 'get_channels') { const { data } = await supabase.from('channels').select('channel_id,channel_name,invite_link'); return res.json({ channels: data || [] }); }
        if (action === 'check_join' && user_id) { const { data: ch } = await supabase.from('channels').select('*'); if (!ch?.length) return res.json({ joined: true }); for (const c of ch) { try { const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${c.channel_id}&user_id=${user_id}`); const j = await r.json(); if (!j.ok || ['left','kicked'].includes(j.result?.status)) return res.json({ joined: false }); } catch(e) { return res.json({ joined: false }); } } return res.json({ joined: true }); }
        if (action === 'get_user' && user_id) { const { data: u } = await supabase.from('bot_users').select('balance').eq('user_id',user_id).single(); return res.json({ balance: u?.balance || 0 }); }
        if (action === 'task_remaining' && user_id && task_id) { const td = new Date().toISOString().split('T')[0]; const { data: tk } = await supabase.from('tasks').select('daily_limit').eq('id',task_id).single(); const lim = tk?.daily_limit || 10; const { data: cp } = await supabase.from('task_completions').select('count_today').eq('user_id',user_id).eq('task_id',task_id).eq('completed_at',td).single(); const done = cp?.count_today || 0; return res.json({ remaining: lim - done, daily_limit: lim }); }
        if (action === 'check_ad' && user_id && task_id) { const td = new Date().toISOString().split('T')[0]; const { data: av } = await supabase.from('ad_views').select('*').eq('user_id',user_id).eq('task_id',task_id).eq('viewed_at',td).single(); return res.json({ viewed: !!av, claimed: av?.is_claimed || false }); }
        return res.send('OK');
    }

    if (req.method === 'POST') {
        if (req.body?.action === 'ad_viewed') { const { user_id, task_id } = req.body; const td = new Date().toISOString().split('T')[0]; const { data: ex } = await supabase.from('ad_views').select('*').eq('user_id',user_id).eq('task_id',task_id).eq('viewed_at',td).single(); if (!ex) await supabase.from('ad_views').insert({ user_id, task_id, viewed_at: td, is_claimed: false }); return res.json({ success: true }); }
        if (req.body?.action === 'claim_task') { const { user_id, task_id } = req.body; const td = new Date().toISOString().split('T')[0]; const { data: av } = await supabase.from('ad_views').select('*').eq('user_id',user_id).eq('task_id',task_id).eq('viewed_at',td).single(); if (!av || av.is_claimed) return res.json({ success: false, message: 'আগে অ্যাড দেখুন!' }); const { data: tk } = await supabase.from('tasks').select('*').eq('id',task_id).single(); if (!tk) return res.json({ success: false, message: 'টাস্ক নেই' }); const { data: cp } = await supabase.from('task_completions').select('*').eq('user_id',user_id).eq('task_id',task_id).eq('completed_at',td).single(); if (cp && cp.count_today >= tk.daily_limit) return res.json({ success: false, message: 'লিমিট শেষ' }); if (cp) await supabase.from('task_completions').update({ count_today: cp.count_today + 1 }).eq('id',cp.id); else await supabase.from('task_completions').insert({ user_id, task_id, completed_at: td, count_today: 1 }); await supabase.rpc('add_balance', { uid: user_id, amount: tk.reward }); await supabase.from('ad_views').update({ is_claimed: true }).eq('id', av.id); const { data: u } = await supabase.from('bot_users').select('balance').eq('user_id',user_id).single(); return res.json({ success: true, reward: tk.reward, new_balance: u.balance }); }
        try { await bot.handleUpdate(req.body, res); } catch(e) { res.send('OK'); }
    }
};
