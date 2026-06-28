const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");

const pendingBaiscope = {};

// Search Baiscope
async function searchBaiscope(query) {
    try {
        const url = `https://baiscope.lk/?s=${encodeURIComponent(query)}`;

        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        });

        const $ = cheerio.load(data);
        const results = [];

        $("article").each((i, el) => {
            const title = $(el).find(".entry-title a").text().trim();
            const link = $(el).find(".entry-title a").attr("href");

            if (title && link) {
                results.push({
                    title,
                    link
                });
            }
        });

        return results;

    } catch (err) {
        console.log(err);
        return [];
    }
}

// Search Command
cmd({
    pattern: "baiscope",
    alias: ["movie", "subtitle"],
    react: "🎬",
    desc: "Search movies from Baiscope",
    category: "search",
    filename: __filename
}, async (danuwa, mek, m, { q, sender, reply }) => {

    if (!q)
        return reply("*🎬 Usage:*\n.baiscope <movie name>");

    reply("*🔍 Searching Baiscope...*");

    const movies = await searchBaiscope(q);

    if (!movies.length)
        return reply("*❌ No movies found.*");

    pendingBaiscope[sender] = {
        movies,
        timestamp: Date.now()
    };

    let txt = "*🎬 Baiscope Search Results*\n\n";

    movies.forEach((movie, i) => {
        txt += `*${i + 1}.* ${movie.title}\n`;
    });

    txt += `\n*Reply with a number (1-${movies.length}) to get the link.*`;

    reply(txt);
});

// Selection Command
cmd({
    filter: (text, { sender }) =>
        pendingBaiscope[sender] &&
        !isNaN(text) &&
        parseInt(text) > 0 &&
        parseInt(text) <= pendingBaiscope[sender].movies.length

}, async (danuwa, mek, m, { body, sender, from }) => {

    const index = Number(body) - 1;

    const movie = pendingBaiscope[sender].movies[index];

    delete pendingBaiscope[sender];

    let msg = `🎬 *${movie.title}*\n\n`;
    msg += `🔗 ${movie.link}`;

    await danuwa.sendMessage(from, {
        text: msg
    }, {
        quoted: mek
    });

});

// Auto clear cache
setInterval(() => {

    const now = Date.now();

    for (const id in pendingBaiscope) {
        if (now - pendingBaiscope[id].timestamp > 10 * 60 * 1000) {
            delete pendingBaiscope[id];
        }
    }

}, 5 * 60 * 1000);
