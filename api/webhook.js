const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Helper: Get or Create User
async function getUser(userId, username, firstName) {
    const { data: user } = await supabase
        .from('bot_users')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (user) return user;

    // Create new user
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

// Start Command
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    const args = ctx.message.text.split(' ');

    // Get/Create user
    const user = await getUser(userId, username, firstName);

    if (args[1]) {
        const refCode = args[1];
        
        // Check if referral code is valid
        const { data: referrer } = await supabase
            .from('bot_users')
            .select('*')
            .eq('refer_code', refCode)
            .single();

        if (referrer && referrer.user_id !== userId) {
            // Check if already referred
            const { data: existingRef } = await supabase
                .from('referrals')
                .select('*')
                .eq('referred_id', userId)
                .single();

            if (!existingRef) {
                // Add referral record
                await supabase.from('referrals').insert({
                    referrer_id: referrer.user_id,
                    referred_id: userId,
                    reward_given: 0.05
                });

                // Update referrer
                await supabase.rpc('increment_refer_count', { uid: referrer.user_id });

                // Update referrer balance +0.05
                await supabase.rpc('add_balance', { uid: referrer.user_id, amount: 0.05 });
                await supabase.rpc('add_refer_earnings', { uid: referrer.user_id, amount: 0.05 });

                // Update referred user balance +0.05
                await supabase.rpc('add_balance', { uid: userId, amount: 0.05 });

                // Notify referrer
                ctx.telegram.sendMessage(referrer.user_id, `🎉 নতুন রেফারেল! আপনি পেয়েছেন $0.05`);

                ctx.reply(`👋 স্বাগতম!\n\nআপনি ${referrer.first_name || 'ইউজার'}-এর রেফারেল হয়ে জয়েন করেছেন।\n\n💰 আপনি $0.05 বোনাস পেয়েছেন!`);
            } else {
                ctx.reply('👋 স্বাগতম! আপনি ইতিমধ্যেই রেফারেল হিসেবে জয়েন করেছেন।');
            }
        } else {
            ctx.reply('👋 স্বাগতম EarnFlow বটে!');
        }
    } else {
        ctx.reply(`👋 স্বাগতম EarnFlow বটে, ${firstName || 'ইউজার'}!\n\n💰 টাস্ক করে টাকা ইনকাম করুন\n👥 রেফারেল করে বোনাস পান\n\n⏳ টাস্ক দেখতে নিচের বাটনে ক্লিক করুন।`, {
            reply_markup: {
                keyboard: [
                    ['📺 টাস্ক', '👥 রেফারেল'],
                    ['💰 ব্যালেন্স', '🏧 উইথড্র'],
                    ['🏆 লিডারবোর্ড', '📞 সাপোর্ট']
                ],
                resize_keyboard: true
            }
        });
    }
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

// Other Buttons
bot.hears('🏧 উইথড্র', (ctx) => ctx.reply('🏧 উইথড্র সিস্টেম শীঘ্রই আসছে...'));
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
bot.hears('📞 সাপোর্ট', (ctx) => ctx.reply('📞 সাপোর্ট: @admin'));

// WebApp Data Handler
bot.on('web_app_data', async (ctx) => {
    const data = JSON.parse(ctx.webAppData.data);
    
    if (data.action === 'claim' && data.task_id) {
        const userId = ctx.from.id;
        const taskId = data.task_id;
        const today = new Date().toISOString().split('T')[0];

        // Get task info
        const { data: task } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .single();

        if (!task) {
            return ctx.reply('❌ টাস্ক পাওয়া যায়নি।');
        }

        // Check daily limit
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

        // Update task completion
        if (completion) {
            await supabase
                .from('task_completions')
                .update({ count_today: completion.count_today + 1 })
                .eq('id', completion.id);
        } else {
            await supabase.from('task_completions').insert({
                user_id: userId,
                task_id: taskId,
                completed_at: today,
                count_today: 1
            });
        }

        // Add balance
        await supabase.rpc('add_balance', { uid: userId, amount: task.reward });

        ctx.reply(`✅ টাস্ক সম্পন্ন!\n💰 $${task.reward} যোগ হয়েছে।`);
    }
});

// Webhook handler
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
        } catch (error) {
            console.error('Error:', error);
            res.status(200).send('OK');
        }
    } else {
        res.status(200).send('EarnFlow Bot is running!');
    }
};
