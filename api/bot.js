const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

const BASE_HEADERS = {
    'Connection': 'keep-alive',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://id.ytmp3.mobi/v1/',
    'Accept-Encoding': 'gzip, deflate, br'
};

const sleepRandom = (min, max) => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, ms));
};

bot.start((ctx) => ctx.reply('Halo cuy! Kirim link YouTube ke sini, nanti langsung jadi player MP3 instan tanpa nunggu lama.'));

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const match = text.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/))([\w-]{11})/);
    
    if (!match) {
        return ctx.reply('Link kagak valid tuh. Kirim link YouTube yang bener ya.');
    }

    const videoId = match[1];
    const format = 'mp3';
    let statusMsg;

    const currentUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const requestHeaders = {
        ...BASE_HEADERS,
        'User-Agent': currentUA,
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?1',
        'Sec-Ch-Ua-Platform': '"Android"'
    };

    try {
        statusMsg = await ctx.reply('⏳ Menyiapkan player...');

        // 1. Proses Init
        const initUrl = `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`;
        const initRes = await axios.get(initUrl, { headers: requestHeaders });
        if (initRes.data.error > 0) throw new Error('API Target nolak inisialisasi.');

        const convertUrl = initRes.data.convertURL;

        // 2. Proses Konversi
        let convertFullUrl = `${convertUrl}&v=${videoId}&f=${format}&_=${Math.random()}`;
        let convertRes = await axios.get(convertFullUrl, { headers: requestHeaders });

        while (convertRes.data.redirect > 0 && convertRes.data.redirectURL) {
            await sleepRandom(200, 500);
            convertRes = await axios.get(`${convertRes.data.redirectURL}&v=${videoId}&f=${format}&_=${Math.random()}`, { headers: requestHeaders });
        }
        if (convertRes.data.error > 0) throw new Error('Gagal konversi.');

        const progressUrl = convertRes.data.progressURL;
        const downloadUrl = convertRes.data.downloadURL;
        let title = convertRes.data.title || 'Audio';

        // 3. Proses Progress Polling
        let isComplete = false;
        while (!isComplete) {
            const progressRes = await axios.get(progressUrl, { headers: requestHeaders });
            if (progressRes.data.error > 0) throw new Error('Gagal progres.');
            if (progressRes.data.title) title = progressRes.data.title;
            
            if (progressRes.data.progress >= 3) {
                isComplete = true;
            } else {
                await sleepRandom(1000, 2000);
            }
        }

        // 4. BUAT PROXY LINK STREAMING (Biar ga kena 403 Forbidden dari target)
        // Menggunakan domain Vercel lu sendiri secara dinamis
        const vercelDomain = `https://${ctx.workerInboundStreamContext?.host || req?.headers?.host || 'botytmp3.vercel.app'}`;
        const proxyStreamUrl = `${vercelDomain}/api/bot?stream=true&url=${encodeURIComponent(downloadUrl)}`;

        // 5. Kirim langsung pake URL player proxy
        await ctx.replyWithAudio({ 
            url: proxyStreamUrl, 
            title: title,
            filename: `${title}.mp3`
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error(error.message);
        if (statusMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ Error: ${error.message}`);
        } else {
            await ctx.reply(`❌ Error: ${error.message}`);
        }
    }
});

// Handler Webhook Vercel + Mini Proxy Streamer
module.exports = async (req, res) => {
    // JIKA REQUEST ADALAH STREAMING AUDIO DARI TELEGRAM
    if (req.method === 'GET' && req.query.stream === 'true' && req.query.url) {
        try {
            const targetUrl = decodeURIComponent(req.query.url);
            
            // Ambil data dari ymcdn dalam bentuk stream, suntik header Referer-nya di sini!
            const response = await axios({
                method: 'get',
                url: targetUrl,
                headers: BASE_HEADERS,
                responseType: 'stream'
            });

            // Set header respons biar dibaca sebagai file MP3 oleh Telegram
            res.setHeader('Content-Type', 'audio/mpeg');
            if (response.headers['content-length']) {
                res.setHeader('Content-Length', response.headers['content-length']);
            }

            // Alirkan datanya secara real-time (Piping) tanpa nampung di RAM Vercel!
            response.data.pipe(res);
        } catch (err) {
            console.error('Streaming error:', err.message);
            res.status(500).send('Streaming failed');
        }
        return;
    }

    // JIKA REQUEST DARI WEBHOOK TELEGRAM (POST)
    try {
        if (req.method === 'POST') {
            // Menyisipkan objek req ke dalam context telegraf agar host bisa dibaca dinamis
            bot.context.workerInboundStreamContext = { host: req.headers.host };
            await bot.handleUpdate(req.body, res);
        } else {
            res.status(200).json({ status: 'Bot aman, mode stream player aktif!' });
        }
    } catch (e) {
        console.error('Vercel Webhook Error:', e);
        res.status(200).send('Error handled'); 
    }
};
