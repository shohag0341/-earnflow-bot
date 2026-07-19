const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Start Command
bot.start((ctx) => {
    const args = ctx.message.text.split(' ');
    
    if (args[1]) {
        // Referral link দিয়ে এসেছে
        const refCode = args[1];
        ctx.reply(`🔗 রেফারেল কোড: ${refCode}\n\nস্বাগতম! আপনি রেফারেল লিংক থেকে জয়েন করেছেন।`);
    } else {
        ctx.reply(`👋 স্বাগতম EarnFlow বটে!\n\n💰 টাস্ক করে টাকা ইনকাম করুন\n👥 রেফারেল করে বোনাস পান\n\n⏳ টাস্ক দেখতে নিচের বাটনে ক্লিক করুন।`, {
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
bot.hears('📺 টাস্ক', (ctx) => {
    ctx.reply('📺 উপলব্ধ টাস্ক:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '▶️ ভিডিও দেখুন - $0.01', web_app: { url: `${process.env.BASE_URL}/webapp/` } }]
            ]
        }
    });
});

// Balance Button
bot.hears('💰 ব্যালেন্স', (ctx) => {
    ctx.reply(`💰 আপনার ব্যালেন্স\n\n💵 মোট: $0.00\n📊 টাস্ক থেকে: $0.00\n👥 রেফারেল থেকে: $0.00`);
});

// Referral Button
bot.hears('👥 রেফারেল', (ctx) => {
    const userId = ctx.from.id;
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${userId}`;
    
    ctx.reply(`👥 রেফারেল প্রোগ্রাম\n\n🔗 আপনার রেফারেল লিংক:\n${refLink}\n\n📊 মোট রেফারেল: 0\n💰 রেফারেল আর্নিং: $0.00\n\nপ্রতি রেফারেলে আপনি পাবেন $0.05!`);
});

// Other buttons (placeholder)
bot.hears('🏧 উইথড্র', (ctx) => ctx.reply('🏧 উইথড্র সিস্টেম শীঘ্রই আসছে...'));
bot.hears('🏆 লিডারবোর্ড', (ctx) => ctx.reply('🏆 লিডারবোর্ড শীঘ্রই আসছে...'));
bot.hears('📞 সাপোর্ট', (ctx) => ctx.reply('📞 সাপোর্ট: @admin'));

// WebApp Data Handler
bot.on('web_app_data', (ctx) => {
    const data = JSON.parse(ctx.webAppData.data);
    
    if (data.action === 'claim') {
        ctx.reply('✅ টাস্ক সম্পন্ন হয়েছে! $0.01 আপনার ব্যালেন্সে যোগ হবে।');
    }
});

// Webhook handler for Vercel
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body, res);
    } else {
        res.status(200).send('EarnFlow Bot is running!');
    }
};
