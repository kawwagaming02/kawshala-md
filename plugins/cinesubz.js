const { cmd } = require("../command");
const puppeteer = require("puppeteer");

const pendingBaiscope = {};

async function searchBaiscope(query) {
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ]
        });

        const page = await browser.newPage();

        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36"
        );

        await page.goto(
            `https://baiscope.lk/?s=${encodeURIComponent(query)}`,
            {
                waitUntil: "networkidle2",
                timeout: 60000
            }
        );

        const movies = await page.evaluate(() => {

            const results = [];

            document.querySelectorAll("article").forEach(article => {

                const a = article.querySelector("h2 a, .entry-title a");

                if (a) {
                    results.push({
                        title: a.innerText.trim(),
                        link: a.href
                    });
                }

            });

            return results;
        });

        await browser.close();

        return movies;

    } catch (e) {

        if (browser) await browser.close();

        console.log(e);

        return [];
    }
}

cmd({
    pattern: "baiscope",
    alias: ["movie"],
    react: "🎬",
    desc: "Search movies from Baiscope",
    category: "search",
    filename: __filename

}, async (conn, mek, m, { q, sender, reply }) => {

    if (!q)
        return reply("*Example:*\n.baiscope Avatar");

    await reply("🔍 Searching Baiscope...");

    const movies = await searchBaiscope(q);

    if (!movies.length)
        return reply("❌ No movies found.");

    pendingBaiscope[sender] = {
        movies,
        timestamp: Date.now()
    };

    let text = "*🎬 Search Results*\n\n";

    movies.forEach((v, i) => {
        text += `${i + 1}. ${v.title}\n`;
    });

    text += `\n\nReply with a number (1-${movies.length})`;

    reply(text);

});

cmd({

    filter: (text, { sender }) =>
        pendingBaiscope[sender] &&
        !isNaN(text) &&
        Number(text) >= 1 &&
        Number(text) <= pendingBaiscope[sender].movies.length

}, async (conn, mek, m, { body, sender, from }) => {

    const movie = pendingBaiscope[sender].movies[Number(body) - 1];

    delete pendingBaiscope[sender];

    await conn.sendMessage(from, {
        text:
`🎬 *${movie.title}*

🔗 ${movie.link}`
    }, {
        quoted: mek
    });

});

setInterval(() => {

    const now = Date.now();

    for (const id in pendingBaiscope) {

        if (now - pendingBaiscope[id].timestamp > 600000) {
            delete pendingBaiscope[id];
        }

    }

}, 300000);
