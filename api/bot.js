const { Telegraf } = require('telegraf');
const axios = require('axios');

// Token bot diambil dari Environment Variables (Vercel .env)
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
    'Referer': 'https://id.ytmp3.mobi/v1/',
    'Accept-Encoding': 'gzip, deflate, br'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Perintah /start
bot.start((ctx) => ctx.reply('Halo! Kirimkan link YouTube (contoh: https://youtu.be/...) dan saya akan mengunduh MP3-nya untuk Anda.'));

// Menangani pesan teks (link YouTube)
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    // Regex sederhana untuk mengekstrak ID YouTube dari berbagai format link
    const match = text.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/))([\w-]{11})/);
    
    if (!match) {
        return ctx.reply('Link tidak valid. Pastikan Anda mengirimkan link YouTube yang benar.');
    }

    const videoId = match[1];
    const format = 'mp3';
    let statusMsg;

    try {
        statusMsg = await ctx.reply('⏳ Memulai inisialisasi sistem...');

        // 1. Proses Init
        const initUrl = `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`;
        const initRes = await axios.get(initUrl, { headers: BASE_HEADERS });
        if (initRes.data.error > 0) throw new Error('Gagal inisialisasi API target');

        const convertUrl = initRes.data.convertURL;

        // 2. Proses Konversi
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚙️ Mengonversi video...');
        let convertFullUrl = `${convertUrl}&v=${videoId}&f=${format}&_=${Math.random()}`;
        let convertRes = await axios.get(convertFullUrl, { headers: BASE_HEADERS });

        while (convertRes.data.redirect > 0 && convertRes.data.redirectURL) {
            convertRes = await axios.get(`${convertRes.data.redirectURL}&v=${videoId}&f=${format}&_=${Math.random()}`, { headers: BASE_HEADERS });
        }
        if (convertRes.data.error > 0) throw new Error('Terjadi error saat konversi');

        const progressUrl = convertRes.data.progressURL;
        const downloadUrl = convertRes.data.downloadURL;
        let title = convertRes.data.title || 'Audio';

        // 3. Proses Progress Polling
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '🔄 Mengecek progress konversi (harap bersabar)...');
        let isComplete = false;

        while (!isComplete) {
            const progressRes = await axios.get(progressUrl, { headers: BASE_HEADERS });
            if (progressRes.data.error > 0) throw new Error('Error saat mengecek progress');
            if (progressRes.data.title) title = progressRes.data.title;
            
            if (progressRes.data.progress >= 3) {
                isComplete = true;
            } else {
                await sleep(1000);
            }
        }

        // 4. Unduh file ke memory (ArrayBuffer) karena Telegram butuh file asli
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '📥 Konversi selesai! Sedang mengunggah file ke Telegram...');
        const audioRes = await axios.get(downloadUrl, { 
            headers: BASE_HEADERS, 
            responseType: 'arraybuffer' 
        });

        // 5. Kirim Audio ke Chat
        await ctx.replyWithAudio({ 
            source: Buffer.from(audioRes.data), 
            filename: `${title}.mp3` 
        });

        // Hapus pesan status agar chat bersih
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('Error details:', error);
        if (statusMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ Maaf, terjadi kesalahan: ${error.message}`);
        } else {
            await ctx.reply(`❌ Maaf, terjadi kesalahan: ${error.message}`);
        }
    }
});

// Handler wajib untuk Vercel Serverless Function
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        } else {
            // Memastikan route ini bisa diakses browser untuk testing
            res.status(200).json({ status: 'Bot is active and running smoothly!' });
        }
    } catch (e) {
        console.error('Vercel Webhook Error:', e);
        // Selalu return 200 ke Telegram agar Telegram tidak melakukan retry berulang kali
        res.status(200).send('Error handled'); 
    }
};
