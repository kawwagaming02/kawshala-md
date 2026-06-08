const { cmd } = require('../command');
const axios = require('axios');

const TMDB_API_KEY = 'b620fccc7fcc5a6863e5b69745958243'
const TMDB_API = 'https://api.themoviedb.org/3/search/movie'
const IMG_URL = 'https://image.tmdb.org/t/p/w500'

cmd(
    {
        pattern: 'movie',
        alias: ['mv', 'film', 'moviesearch'],
        react: '🎬',
        desc: 'Search Movie Details 🎥',
        category: 'search',
        filename: __filename,
    },
    async (
        kawa,
        mek,
        m,
        {
            from,
            quoted,
            q,
            reply,
        }
    ) => {
        try {
            if (!q) return reply('*Please provide a movie name!* 🎬');

            reply(`*Searching Movie for you...* 🔍`);

            const search = await axios.get(TMDB_API, {
                params: {
                    api_key: TMDB_API_KEY,
                    query: q
                }
            });

            if (!search.data.results || search.data.all.length === 0) {
                return reply('*No results found for that movie* 😢');
            }

            const results = search.data.results.slice(0, 5);
            let formattedResults = results.map((v, i) => {
                const year = v.release_date? v.release_date.split('-')[0] : 'N/A'
                return `*${i + 1}. ${v.title}* (${year})\n*Rating:* ${v.vote_average.toFixed(1)}/10 ⭐ | *Lang:* ${v.original_language.toUpperCase()}\n*Overview:* ${v.overview.slice(0, 100)}...`
            }).join('\n\n');

            const topMovie = results[0]
            const caption = `*Your movie search results* 🎬\n\n*Query:* ${q}\n\n${formattedResults}`

            if (topMovie.poster_path) {
                await kawa.sendMessage(
                    from,
                    {
                        image: { url: `${IMG_URL}${topMovie.poster_path}` },
                        caption: caption,
                    },
                    { quoted: mek }
                );
            } else {
                reply(caption)
            }

        } catch (err) {
            console.error(err);
            reply('*An error occurred while searching Movie* ❌');
        }
    }
);
