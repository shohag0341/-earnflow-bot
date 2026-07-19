const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// Helper: Get or Create User
async function getUser(userId, username, firstName) {
    const { data: user } = await supabase
        .from('bot_users')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (user) return user;

    const referCode = `REF${userId}`;
    const { data: newUser } = await supabase
        .from('bot_users')
        .insert({
            user_id: userId,
            username: username || '',
            first_name: firstName || '',
            refer_code: referCode,
            balance: 0
        })
        .select()
        .single();

    return newUser;
}

// Helper: Check Channel Join
async function checkChannels(ctx) {
    const { data: channels } = await supabase.from('channels').select('*');
    
    if (!channels || channels.length === 0) return true;

    const notJoined = [];
    
    for (const channel of channels) {
        try {
            const member = await ctx.telegram.getChatMember(channel.channel_id, ctx.from.id);
            if (['left', 'kicked'].includes(member.status)) {
                notJoined.push(channel);
            }
        } catch (e) {
            // Bot not admin in channel, skip
        }
    }

    if (notJoined.length > 0) {
        const buttons = [];
        for (const ch of notJoined) {
            const link = ch.channel_id.toString().replace('-100', '');
            buttons.push([{ text: `📢 ${ch.channel_name || 'চ্যানেল'} জয়েন করুন`, url: `https://t.me/${link}` }]);
        }
        buttons.push([{ text: '✅ জয়েন করেছি', callback_data: 'check_join' }]);

        await ctx.reply('⚠️ বট ব্যবহার করতে নিচের চ্যানেলগুলোতে জয়েন করুন:', {
            reply_markup: { inline_keyboard: buttons }
        });
        return false;
    }

    return true;
}

// Channel Join Check Callback
bot.action('check_join', async (ctx) => {
    await ctx.answerCbQuery();
    const joined = await checkChannels(ctx);
    if (joined) {
        await ctx.deleteMessage();
        await ctx.reply('✅ ভেরিফাইড! এখন বট ব্যবহার করতে পারবেন।\n\n/start দিয়ে শুরু করুন।');
    } else {
        await ctx.answerCbQuery('❌ এখনো সব চ্যানেলে জয়েন করেননি!', { show_alert: true });
    }
});

// Start Command
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const args = ctx.message.text.split(' ');

    const user = await getUser(userId, username, firstName);

    if (args[1]) {
        const refCode = args[1];
        
        const { data: referrer } = await supabase
            .from('bot_users')
            .select('*')
            .eq('refer_code', refCode)
            .single();

        if (referrer && referrer.user_id !== userId) {
            const { data: existingRef } = await supabase
                .from('referrals')
                .select('*')
                .eq('referred_id', userId)
                .single();

            if (!existingRef) {
                await supabase.from('referrals').insert({
                    referrer_id: referrer.user_id,
                    referred_id: userId,
                    reward_given: 0.05
                });

                await supabase.rpc('increment_refer_count', { uid: referrer.user_id });
                await supabase.rpc('add_balance', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_refer_earnings', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_balance', { uid: userId, amount: 0.05 });

                ctx.telegram.sendMessage(referrer.user_id, `🎉 নতুন রেফারেল! আপনি পেয়েছেন $0.05`);

                return ctx.reply(`👋 স্বাগতম!\n\nআপনি ${referrer.first_name || 'ইউজার'}-এর রেফারেল হয়ে জয়েন করেছেন।\n\n💰 আপনি $0.05 বোনাস পেয়েছেন!`);
            }
        }
    }

    return ctx.reply(`👋 স্বাগতম EarnFlow বটে, ${firstName || 'ইউজার'}!\n\n💰 টাস্ক করে টাকা ইনকাম করুন\n👥 রেফারেল করে বোনাস পান`, {
        reply_markup: {
            keyboard: [
                ['📺 টাস্ক', '👥 রেফারেল'],
                ['💰 ব্যালেন্স', '🏧 উইথড্র'],
                ['🏆 লিডারবোর্ড', '📞 সাপোর্ট']
            ],
            resize_keyboard: true
        }
    });
});

// ALL MESSAGE HANDLER with Channel Check
bot.on('message', async (ctx, next) => {
    // Skip if admin
    if (ctx.from.id === ADMIN_ID) return next();
    
    // Skip if no text (photos, etc)
    if (!ctx.message.text) return next();
    
    // Check channels
    const joined = await checkChannels(ctx);
    if (!joined) return;
    
    return next();
});

// Task Button
bot.hears('📺 টাস্ক', async (ctx) => {
    const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .order('id', { ascending: true });

    if (!tasks || tasks.length === 0) {
        return ctx.reply('⚠️ এখনো কোনো টাস্ক যোগ করা হয়নি।');
    }

    const buttons = tasks.map(task => {
        const data = encodeURIComponent(JSON.stringify({
            task_id: task.id,
            title: task.title,
            reward: task.reward,
            icon: task.icon,
            ad_link: task.ad_link
        }));
        return [{ text: `${task.icon} ${task.title} - $${task.reward}`, web_app: { url: `${process.env.BASE_URL}/webapp/?data=${data}` } }];
    });

    ctx.reply('📺 উপলব্ধ টাস্ক:', {
        reply_markup: { inline_keyboard: buttons }
    });
});

// Balance Button
bot.hears('💰 ব্যালেন্স', async (ctx) => {
    const user = await getUser(ctx.from.id);
    ctx.reply(`💰 আপনার ব্যালেন্স\n\n💵 মোট: $${user.balance.toFixed(2)}\n👥 রেফারেল: ${user.refer_count} জন\n📊 রেফারেল আর্নিং: $${user.refer_earnings.toFixed(2)}`);
});

// Referral Button
bot.hears('👥 রেফারেল', async (ctx) => {
    const user = await getUser(ctx.from.id);
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${user.refer_code}`;
    
    ctx.reply(`👥 রেফারেল প্রোগ্রাম\n\n🔗 আপনার রেফারেল লিংক:\n\`${refLink}\`\n\n📊 মোট রেফারেল: ${user.refer_count} জন\n💰 রেফারেল আর্নিং: $${user.refer_earnings.toFixed(2)}\n\nপ্রতি রেফারেলে আপনি পাবেন $0.05!`, {
        parse_mode: 'Markdown'
    });
});

// Leaderboard
bot.hears('🏆 লিডারবোর্ড', async (ctx) => {
    const { data: topUsers } = await supabase
        .from('bot_users')
        .select('first_name, balance')
        .order('balance', { ascending: false })
        .limit(10);

    if (!topUsers || topUsers.length === 0) {
        return ctx.reply('🏆 এখনো কোনো ইউজার নেই।');
    }

    let msg = '🏆 টপ ১০ আর্নার\n\n';
    topUsers.forEach((user, index) => {
        const medals = ['🥇', '🥈', '🥉'];
        const medal = medals[index] || `${index + 1}️⃣`;
        msg += `${medal} ${user.first_name || 'ইউজার'}: $${user.balance.toFixed(2)}\n`;
    });

    ctx.reply(msg);
});

bot.hears('🏧 উইথড্র', (ctx) => ctx.reply('🏧 উইথড্র সিস্টেম শীঘ্রই আসছে...'));
bot.hears('📞 সাপোর্ট', (ctx) => ctx.reply('📞 সাপোর্ট: @admin'));

// ============ ADMIN COMMANDS ============

bot.command('addchannel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('⚠️ ব্যবহার: /addchannel @channelusername');
    }

    const channelUsername = args[1].replace('@', '');
    
    try {
        const chat = await ctx.telegram.getChat(`@${channelUsername}`);
        
        const { data: existing } = await supabase
            .from('channels')
            .select('*')
            .eq('channel_id', chat.id)
            .single();

        if (existing) {
            return ctx.reply('⚠️ এই চ্যানেলটি আগেই যোগ করা আছে!');
        }



        
        // Get invite link
let inviteLink = `https://t.me/${channelUsername}`;
try {
    const link = await ctx.telegram.createChatInviteLink(chat.id);
    inviteLink = link.invite_link;
} catch (e) {
    // Use default link
}

await supabase.from('channels').insert({
    channel_id: chat.id,
    channel_name: chat.title,
    invite_link: inviteLink
});



        
        ctx.reply(`✅ চ্যানেল যোগ করা হয়েছে: ${chat.title}`);
    } catch (e) {
        ctx.reply('❌ চ্যানেল পাওয়া যায়নি! বটকে চ্যানেলে অ্যাডমিন করুন।');
    }
});

bot.command('removechannel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('⚠️ ব্যবহার: /removechannel @channelusername');
    }

    const channelUsername = args[1].replace('@', '');
    
    try {
        const chat = await ctx.telegram.getChat(`@${channelUsername}`);
        await supabase.from('channels').delete().eq('channel_id', chat.id);
        ctx.reply(`✅ চ্যানেল রিমুভ করা হয়েছে: ${chat.title}`);
    } catch (e) {
        ctx.reply('❌ চ্যানেল পাওয়া যায়নি!');
    }
});

bot.command('channels', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const { data: channels } = await supabase.from('channels').select('*');
    if (!channels || channels.length === 0) {
        return ctx.reply('⚠️ কোনো চ্যানেল যোগ করা নেই।');
    }

    let msg = '📢 চ্যানেল লিস্ট:\n\n';
    channels.forEach((ch, i) => {
        msg += `${i + 1}. ${ch.channel_name}\n`;
    });
    ctx.reply(msg);
});

bot.command('addtask', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const text = ctx.message.text.replace('/addtask ', '');
    const args = text.split('|');
    
    if (args.length < 3) {
        return ctx.reply('⚠️ ব্যবহার:\n/addtask টাইটেল | রিওয়ার্ড | অ্যাড লিংক | আইকন | ডেইলি লিমিট\n\nউদাহরণ:\n/addtask ভিডিও দেখুন | 0.01 | https://youtube.com | 📺 | 10');
    }

    const title = args[0].trim();
    const reward = parseFloat(args[1].trim());
    const adLink = args[2].trim();
    const icon = args[3]?.trim() || '📺';
    const dailyLimit = parseInt(args[4]?.trim() || '10');

    await supabase.from('tasks').insert({ title, reward, ad_link: adLink, icon, daily_limit });
    ctx.reply(`✅ টাস্ক যোগ করা হয়েছে!\n\n${icon} ${title}\n💰 $${reward}\n📊 লিমিট: ${dailyLimit}/দিন`);
});

bot.command('tasks', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const { data: tasks } = await supabase.from('tasks').select('*');
    if (!tasks || tasks.length === 0) return ctx.reply('⚠️ কোনো টাস্ক নেই।');

    let msg = '📺 টাস্ক লিস্ট:\n\n';
    tasks.forEach(t => {
        msg += `🆔 ${t.id}: ${t.icon} ${t.title} - $${t.reward}\n`;
    });
    ctx.reply(msg);
});

bot.command('removetask', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const taskId = parseInt(ctx.message.text.split(' ')[1]);
    if (!taskId) return ctx.reply('⚠️ /removetask টাস্ক_আইডি');
    await supabase.from('tasks').delete().eq('id', taskId);
    ctx.reply(`✅ টাস্ক #${taskId} রিমুভ করা হয়েছে।`);
});

bot.command('users', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const { data: users } = await supabase.from('bot_users').select('*').order('joined_at', { ascending: false }).limit(20);
    if (!users || users.length === 0) return ctx.reply('⚠️ কোনো ইউজার নেই।');

    let msg = `👥 ইউজার লিস্ট:\n\n`;
    users.forEach(u => {
        msg += `🆔 ${u.user_id}: ${u.first_name || 'N/A'} - $${u.balance.toFixed(2)}\n`;
    });
    ctx.reply(msg);
});

bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.reply('👑 অ্যাডমিন প্যানেল\n\n/addchannel @username\n/removechannel @username\n/channels\n/addtask\n/removetask id\n/tasks\n/users');
});

// WebApp Data Handler
bot.on('web_app_data', async (ctx) => {
    const data = JSON.parse(ctx.webAppData.data);
    
    if (data.action === 'claim' && data.task_id) {
        const userId = ctx.from.id;
        const taskId = data.task_id;
        const today = new Date().toISOString().split('T')[0];

        const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
        if (!task) return ctx.reply('❌ টাস্ক পাওয়া যায়নি।');

        const { data: completion } = await supabase
            .from('task_completions')
            .select('*')
            .eq('user_id', userId)
            .eq('task_id', taskId)
            .eq('completed_at', today)
            .single();

        if (completion && completion.count_today >= task.daily_limit) {
            return ctx.reply(`⚠️ আজকের লিমিট শেষ! (${task.daily_limit} বার)`);
        }

        if (completion) {
            await supabase.from('task_completions').update({ count_today: completion.count_today + 1 }).eq('id', completion.id);
        } else {
            await supabase.from('task_completions').insert({ user_id: userId, task_id: taskId, completed_at: today, count_today: 1 });
        }

        await supabase.rpc('add_balance', { uid: userId, amount: task.reward });
        ctx.reply(`✅ টাস্ক সম্পন্ন!\n💰 $${task.reward} যোগ হয়েছে।`);
    }
});

// Webhook handler
module.exports = async (req, res) => {
    if (req.method === 'GET') {
        const { action, user_id } = req.query;

        // Get channels list
        if (action === 'get_channels') {
            const { data: channels } = await supabase.from('channels').select('*');
            return res.status(200).json({ channels: channels || [] });
        }

        // Check if user joined all channels
        if (action === 'check_join' && user_id) {
            const { data: channels } = await supabase.from('channels').select('*');
            
            if (!channels || channels.length === 0) {
                return res.status(200).json({ joined: true });
            }

            for (const channel of channels) {
                try {
                    const response = await fetch(
                        `https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember?chat_id=${channel.channel_id}&user_id=${user_id}`
                    );
                    const result = await response.json();
                    
                    if (!result.ok || ['left', 'kicked'].includes(result.result?.status)) {
                        return res.status(200).json({ joined: false });
                    }
                } catch (e) {
                    return res.status(200).json({ joined: false });
                }
            }

            return res.status(200).json({ joined: true });
        }

        return res.status(200).send('EarnFlow Bot is running!');
    }

    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
        } catch (error) {
            console.error('Error:', error);
            res.status(200).send('OK');
        }
    }
};
