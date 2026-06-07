const { Telegraf } = require('telegraf');
const axios = require('axios');

// Token bot diambil dari Environment Variables (Vercel .env)
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Kumpulan User-Agent modern (Android, iOS, Windows, Mac) biar diacak
const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
];

// Base headers yang wajib ada bawaan web asli
const BASE_HEADERS = {
    'Connection': 'keep-alive',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://id.ytmp3.mobi/v1/',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site'
};

// Fungsi jeda dinamis (acak) biar polanya gak kebaca robot kaku
const sleepRandom = (min, max) => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
};

// Perintah /start
bot.start((ctx) => ctx.reply('Halo cuy! Kirim aja link YouTube ke sini, nanti langsung gua ganti jadi file MP3.'));

// Menangani pesan teks (link YouTube)
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    // Regex nge-track ID YouTube
    const match = text.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/))([\w-]{11})/);
    
    if (!match) {
        return ctx.reply('Waduh, linknya kagak valid tuh. Kirim link YouTube yang bener ya.');
    }

    const videoId = match[1];
    const format = 'mp3';
    let statusMsg;

    // Acak User-Agent setiap ada request baru masuk
    const currentUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    
    // Gabungin header bawaan dengan bypass browser modern
    const requestHeaders = {
        ...BASE_HEADERS,
        'User-Agent': currentUA,
        // Ngesimulasiin kalau request ini beneran datang dari browser Mobile Chrome
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?1',
        'Sec-Ch-Ua-Platform': '"Android"'
    };

    try {
        statusMsg = await ctx.reply('⏳ Tunggu bentar, lagi inisialisasi...');

        // 1. Proses Init
        const initUrl = `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`;
        const initRes = await axios.get(initUrl, { headers: requestHeaders });
        if (initRes.data.error > 0) throw new Error('API Target nolak inisialisasi.');

        const convertUrl = initRes.data.convertURL;

        // 2. Proses Konversi
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚙️ Video lu lagi dikonversi...');
        let convertFullUrl = `${convertUrl}&v=${videoId}&f=${format}&_=${Math.random()}`;
        let convertRes = await axios.get(convertFullUrl, { headers: requestHeaders });

        while (convertRes.data.redirect > 0 && convertRes.data.redirectURL) {
            // Kasih delay tipis sebelum nembak redirect biar aman
            await sleepRandom(300, 700);
            convertRes = await axios.get(`${convertRes.data.redirectURL}&v=${videoId}&f=${format}&_=${Math.random()}`, { headers: requestHeaders });
        }
        if (convertRes.data.error > 0) throw new Error('Gagal pas proses konversi di servernya.');

        const progressUrl = convertRes.data.progressURL;
        const downloadUrl = convertRes.data.downloadURL;
        let title = convertRes.data.title || 'Audio';

        // 3. Proses Progress Polling dengan jeda acak manusiawi
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '🔄 Lagi ngecek antrean konversi...');
        let isComplete = false;

        while (!isComplete) {
            const progressRes = await axios.get(progressUrl, { headers: requestHeaders });
            if (progressRes.data.error > 0) throw new Error('Gagal ngecek progress antrean.');
            if (progressRes.data.title) title = progressRes.data.title;
            
            if (progressRes.data.progress >= 3) {
                isComplete = true;
            } else {
                // DI SINI NGAKALINNYA: Jeda acak antara 1,2 sampai 2,5 detik, ga kaku 1 detik terus
                await sleepRandom(1200, 2500);
            }
        }

        // 4. Download file ke memory server Vercel
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '📥 Konversi beres! Sekarang lagi diunggah ke Telegram...');
        const audioRes = await axios.get(downloadUrl, { 
            headers: requestHeaders, 
            responseType: 'arraybuffer' 
        });

        // 5. Kirim Audio langsung ke user
        await ctx.replyWithAudio({ 
            source: Buffer.from(audioRes.data), 
            filename: `${title}.mp3` 
        });

        // Hapus status teks biar bersih
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('Error info:', error.message);
        if (statusMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ Waduh ada error: ${error.message}`);
        } else {
            await ctx.reply(`❌ Waduh ada error: ${error.message}`);
        }
    }
});

// Handler Webhook Vercel
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        } else {
            res.status(200).json({ status: 'Bot aman dan lancar jaya!' });
        }
    } catch (e) {
        console.error('Vercel Webhook Error:', e);
        res.status(200).send('Error managed'); 
    }
};
