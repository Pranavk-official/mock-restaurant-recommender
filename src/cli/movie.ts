// src/cli/movieCli.ts
import chalk from 'chalk';
import readline from 'readline';
import type { User } from '../common/types';
import type { Movie, UserMoviePreferences } from '../movies/types';
import {
    getMovieDetails as getTMDBMovieDetails,
    searchMovies as searchTMDBMovies,
    getPosterUrl,
    getMovieGenreList,
} from '../common/tmdbService';
import type { TMDBMovie as TMDBMovieFromService } from '../common/tmdbService';
import {
    saveMovie, getMovieByTmdbId, saveUserMovieRating, getRatedMovieIdsByUser,
    getUserMoviePreferences, saveUserMoviePreferences, getMovieByOurId
} from '../db/movieDb';
import { getMovieRecommendationsForUser } from '../movies/recommender';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

// --- Display Functions (keep as is) ---
function displayMovieSummary(movie: Movie): void { /* ... */
    console.log(chalk.magenta("\n----------------------------------------"));
    console.log(chalk.bold.yellowBright(`✨ ${movie.title} (${movie.release_date?.substring(0,4) || 'N/A'}) ✨`));
    console.log(chalk.dim(`   Our DB ID: ${movie.id} | TMDB ID: ${movie.tmdb_id}`));
    console.log(`   Rating: ⭐ ${movie.vote_average?.toFixed(1)}/10 (${movie.vote_count} votes)`);
    const genres = movie.genres?.map(g => g.name).join(', ') || 'N/A';
    console.log(`   Genres: ${genres}`);
    console.log(`   Runtime: ${movie.runtime ? `${movie.runtime} min` : 'N/A'}`);
    if (movie.overview) {
        console.log(chalk.gray(`   Overview: ${movie.overview.substring(0, 120)}...`));
    }
    const poster = getPosterUrl(movie.poster_path, 'w154');
    if (poster) console.log(chalk.dim(`   Poster: ${poster}`));
    console.log(chalk.magenta("----------------------------------------"));
}

async function viewAndInteractWithMovieDetails(movieToView: Movie, currentUser: User): Promise<'liked' | 'disliked' | 'skipped' | 'quit'> { /* ... (keep as is, it already returns interaction status) ... */
    console.log(chalk.cyan(`\nFetching latest full details for "${movieToView.title}" (TMDB ID: ${movieToView.tmdb_id})...`));
    const tmdbDetails = await getTMDBMovieDetails(movieToView.tmdb_id);

    if (!tmdbDetails) {
        console.log(chalk.red("Could not fetch full movie details from TMDB. Showing cached info if available."));
        displayMovieSummary(movieToView);
    } else {
        const updatedMovieInDb = await saveMovie(tmdbDetails);
        if (!updatedMovieInDb) {
            console.log(chalk.red("Error updating movie details in our database. Displaying potentially stale info."));
            displayMovieSummary(movieToView);
        } else {
            console.log(chalk.magenta("\n🎬 MOVIE DETAILS 🎬"));
            console.log(chalk.bold.yellowBright(`${updatedMovieInDb.title} (${updatedMovieInDb.release_date?.substring(0,4)})`));
            console.log(chalk.dim(`   Our DB ID: ${updatedMovieInDb.id} | TMDB ID: ${updatedMovieInDb.tmdb_id}`));
            if(updatedMovieInDb.imdb_id) console.log(`   IMDb ID: ${updatedMovieInDb.imdb_id}`);
            console.log(`   Tagline: ${tmdbDetails.tagline || 'N/A'}`);
            console.log(`   Runtime: ${updatedMovieInDb.runtime ? `${updatedMovieInDb.runtime} min` : 'N/A'}`);
            console.log(`   Rating: ⭐ ${updatedMovieInDb.vote_average?.toFixed(1)}/10 (${updatedMovieInDb.vote_count} votes)`);
            console.log(`   Genres: ${updatedMovieInDb.genres?.map(g => g.name).join(', ') || 'N/A'}`);
            console.log(chalk.cyan("\n--- Overview ---"));
            console.log(updatedMovieInDb.overview || 'N/A');

            if (tmdbDetails.credits?.cast && tmdbDetails.credits.cast.length > 0) {
                console.log(chalk.cyan("\n--- Cast (Top 5) ---"));
                tmdbDetails.credits.cast.slice(0, 5).forEach(c => console.log(`   ${c.name} as ${c.character}`));
            }
            if (tmdbDetails["watch/providers"]?.results) {
                const providers = tmdbDetails["watch/providers"].results["US"];
                if (providers && (providers.flatrate?.length || providers.rent?.length || providers.buy?.length)) {
                    console.log(chalk.cyan("\n--- Watch Providers (US) ---"));
                    if (providers.flatrate?.length) console.log(chalk.greenBright(`   Stream: ${providers.flatrate.map(p=>p.provider_name).join(', ')}`));
                    if (providers.rent?.length) console.log(`   Rent: ${providers.rent.map(p=>p.provider_name).join(', ')}`);
                    if (providers.buy?.length) console.log(`   Buy: ${providers.buy.map(p=>p.provider_name).join(', ')}`);
                } else {
                    console.log(chalk.gray("   No provider information found for US region for this movie."));
                }
            }
            if(tmdbDetails.reviews?.results && tmdbDetails.reviews.results.length > 0) {
                console.log(chalk.cyan("\n--- Reviews (Top 1) ---"));
                const review = tmdbDetails.reviews.results[0]!;
                console.log(`   Author: ${review.author}`);
                console.log(`   "${review.content.substring(0,250)}..."`);
                if(review.url) console.log(chalk.dim(`      Read more: ${review.url}`));
            }
            const poster = getPosterUrl(updatedMovieInDb.poster_path, 'w342');
            if (poster) console.log(chalk.cyan(`\nPoster: ${poster}`));
            console.log(chalk.magenta("----------------------------------------"));
        }
    }
    const internalMovieIdToRate = movieToView.id;
    const movieTitleToRate = movieToView.title;
    while (true) {
        const action = (await ask(chalk.cyan("Action after details: [L]ike (5⭐), [D]islike (1⭐), [N]ext item, [Q]uit to menu: "))).toLowerCase();
        if (action === 'l') {
            await saveUserMovieRating(currentUser.id, internalMovieIdToRate, 5);
            console.log(chalk.green(`You liked "${movieTitleToRate}"!`));
            return 'liked';
        } else if (action === 'd') {
            await saveUserMovieRating(currentUser.id, internalMovieIdToRate, 1);
            console.log(chalk.red(`You disliked "${movieTitleToRate}".`));
            return 'disliked';
        } else if (action === 'n') {
            return 'skipped';
        } else if (action === 'q') {
            return 'quit';
        } else {
            console.log(chalk.yellow("Invalid action."));
        }
    }
}

async function presentMovieRecommendationsOneByOne(
    currentUser: User,
    initialRecommendations: Movie[], // The full list from the recommender function
    // We need to pass the exclude set so if user likes/dislikes, it's updated for subsequent *full* recommendation fetches
    persistentExcludeTmdbIds: Set<number>
) {
    if (initialRecommendations.length === 0) {
        console.log(chalk.yellow("No movie recommendations available based on current criteria."));
        console.log(chalk.yellow("Try rating more movies (Option 2) or adjusting your preferences (Option 4)."));
        return;
    }
    console.log(chalk.bold.yellowBright("\nHere are your movie recommendations, one by one:"));

    // Make a mutable copy of the recommendations to iterate through
    let currentRecommendationQueue = [...initialRecommendations];
    // Keep track of TMDB IDs interacted with *within this specific presentation loop*
    // This is different from persistentExcludeTmdbIds which is for longer-term exclusion.
    const sessionShownTmdbIds = new Set<number>();


    while (currentRecommendationQueue.length > 0) {
        const movie = currentRecommendationQueue.shift(); // Get and remove the top movie

        if (!movie || !movie.id || !movie.tmdb_id) {
            console.warn(chalk.yellow("[CLI] Skipping invalid movie object in recommendations queue."));
            continue;
        }

        // If this TMDB ID has been persistently excluded (e.g., rated before this session)
        // or already shown in this specific one-by-one loop, skip it.
        if (persistentExcludeTmdbIds.has(movie.tmdb_id) || sessionShownTmdbIds.has(movie.tmdb_id)) {
            continue;
        }

        displayMovieSummary(movie);
        sessionShownTmdbIds.add(movie.tmdb_id); // Mark as shown in this session's loop

        let interactionResult: 'liked' | 'disliked' | 'skipped' | 'quit' = 'skipped';

        interactionLoop: while(true) {
            const action = (await ask(chalk.cyan("Choose: [L]ike (5⭐), [D]islike (1⭐), [V]iew Details, [N]ext, [Q]uit to menu: "))).toLowerCase();
            switch (action) {
                case 'l':
                    await saveUserMovieRating(currentUser.id, movie.id, 5);
                    console.log(chalk.green(`You liked "${movie.title}"!`));
                    persistentExcludeTmdbIds.add(movie.tmdb_id); // Add to persistent exclusion for future full rec fetches
                    interactionResult = 'liked';
                    break interactionLoop;
                case 'd':
                    await saveUserMovieRating(currentUser.id, movie.id, 1);
                    console.log(chalk.red(`You disliked "${movie.title}".`));
                    persistentExcludeTmdbIds.add(movie.tmdb_id); // Add to persistent exclusion
                    interactionResult = 'disliked';
                    break interactionLoop;
                case 'v':
                    interactionResult = await viewAndInteractWithMovieDetails(movie, currentUser);
                    if (interactionResult === 'liked' || interactionResult === 'disliked') {
                        persistentExcludeTmdbIds.add(movie.tmdb_id); // Ensure excluded if liked/disliked via details
                    }
                    break interactionLoop; // Result from details determines next step
                case 'n':
                    interactionResult = 'skipped';
                    // Don't add to persistentExcludeTmdbIds just for skipping without rating
                    break interactionLoop;
                case 'q':
                    interactionResult = 'quit';
                    break interactionLoop;
                default:
                    console.log(chalk.yellow("Invalid action."));
            }
        }

        if (interactionResult === 'quit') {
            console.log(chalk.blue("Returning to Movie Menu..."));
            return; // Exit the entire recommendation presentation
        }
        // If 'liked', 'disliked', or 'skipped', the outer `while` loop continues to the next movie
        // from the `currentRecommendationQueue`.
    }

    if (currentRecommendationQueue.length === 0) {
        console.log(chalk.blue("\nFinished presenting all available recommendations from this list."));
    }
}

// --- Search and Manage Preferences Functions (keep as is) ---
async function searchAndSelectMovie(): Promise<TMDBMovieFromService | null> { /* ... */
    const query = (await ask(chalk.green("Search for a movie title: "))).trim();
    if (!query) return null;

    const searchResults = await searchTMDBMovies(query);
    if (!searchResults || searchResults.results.length === 0) {
        console.log(chalk.yellow("No movies found for your search."));
        return null;
    }

    console.log(chalk.cyan("\nSearch Results (top 10):"));
    const displayableResults = searchResults.results.slice(0, 10);
    displayableResults.forEach((movie, index) => {
        console.log(`  ${index + 1}. ${movie.title} (${movie.release_date?.substring(0,4) || 'N/A'}) [TMDB ID: ${movie.id}]`);
    });

    if (displayableResults.length === 0) {
        console.log(chalk.yellow("No displayable search results."));
        return null;
    }
    
    let movieIndex = -1;
    while(true) {
        const choice = (await ask(chalk.green("Select a movie by number (or 0 to cancel): "))).trim();
        if (choice === '0') return null;
        const parsedChoice = parseInt(choice);
        if (!isNaN(parsedChoice) && parsedChoice >= 1 && parsedChoice <= displayableResults.length) {
            movieIndex = parsedChoice - 1;
            break;
        }
        console.log(chalk.red("Invalid selection. Please enter a number from the list or 0."));
    }
    return displayableResults[movieIndex] ?? null;
}
async function manageMoviePreferences(userId: number, currentPrefs?: UserMoviePreferences): Promise<UserMoviePreferences> { /* ... */
    console.log(chalk.cyan("\n--- Manage Movie Preferences ---"));
    let prefs: UserMoviePreferences = currentPrefs || { user_id: userId };

    const allGenres = await getMovieGenreList();
    if (allGenres.length > 0) {
        console.log(chalk.dim("Hint: Available genres from TMDB include: " + allGenres.slice(0,10).map(g => g.name).join(', ') + (allGenres.length > 10 ? ", ..." : "")));
    }

    const genresStr = (await ask(chalk.green(`Preferred Genres (comma-separated, current: ${prefs.preferred_genres?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_genres = genresStr ? genresStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    const langsStr = (await ask(chalk.green(`Preferred Languages (e.g., en,es,fr, current: ${prefs.preferred_languages?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_languages = langsStr ? langsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : undefined;

    const yearMinStr = (await ask(chalk.green(`Minimum Release Year (e.g., 1990, current: ${prefs.release_year_min ?? 'Any'}): `))).trim();
    prefs.release_year_min = yearMinStr ? parseInt(yearMinStr) : undefined;
    if (isNaN(prefs.release_year_min!)) prefs.release_year_min = undefined;

    const yearMaxStr = (await ask(chalk.green(`Maximum Release Year (e.g., 2023, current: ${prefs.release_year_max ?? 'Any'}): `))).trim();
    prefs.release_year_max = yearMaxStr ? parseInt(yearMaxStr) : undefined;
    if (isNaN(prefs.release_year_max!)) prefs.release_year_max = undefined;

    const durMinStr = (await ask(chalk.green(`Minimum Duration (minutes, current: ${prefs.duration_min_minutes ?? 'Any'}): `))).trim();
    prefs.duration_min_minutes = durMinStr ? parseInt(durMinStr) : undefined;
    if (isNaN(prefs.duration_min_minutes!)) prefs.duration_min_minutes = undefined;

    const durMaxStr = (await ask(chalk.green(`Maximum Duration (minutes, current: ${prefs.duration_max_minutes ?? 'Any'}): `))).trim();
    prefs.duration_max_minutes = durMaxStr ? parseInt(durMaxStr) : undefined;
    if (isNaN(prefs.duration_max_minutes!)) prefs.duration_max_minutes = undefined;
    
    const tmdbRatingStr = (await ask(chalk.green(`Minimum TMDB Rating (0-10, current: ${prefs.min_imdb_rating ?? 'Any'}): `))).trim();
    prefs.min_imdb_rating = tmdbRatingStr ? parseFloat(tmdbRatingStr) : undefined;
    if (isNaN(prefs.min_imdb_rating!)) prefs.min_imdb_rating = undefined;

    const providersStr = (await ask(chalk.green(`Preferred Streaming Providers (comma-sep names, e.g. Netflix,Hulu, current: ${prefs.preferred_streaming_providers?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_streaming_providers = providersStr ? providersStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    await saveUserMoviePreferences(prefs);
    console.log(chalk.green("Movie preferences updated successfully!"));
    return prefs;
}


// --- Main CLI Function for Movies ---
export async function runMovieCLI(currentUser: User): Promise<void> {
    let userMoviePrefs = await getUserMoviePreferences(currentUser.id);
    if (!userMoviePrefs) {
        console.log(chalk.yellow("No movie preferences found for you yet. Using general recommendations."));
        console.log(chalk.yellow("You can set your preferences via Option 4."));
        userMoviePrefs = { user_id: currentUser.id };
    }

    // This set will accumulate TMDB IDs of movies liked/disliked *during this entire movie CLI session*
    // to prevent them from being re-recommended if the user asks for recommendations again
    // without exiting the movie menu.
    const sessionPersistentExcludeTmdbIds = new Set<number>();
    // Initialize with movies already rated from DB
    const ratedMovieOurDbIds = await getRatedMovieIdsByUser(currentUser.id);
    const ratedMoviesInDb = (await Promise.all(ratedMovieOurDbIds.map(id => getMovieByOurId(id)))).filter(m => m) as Movie[];
    ratedMoviesInDb.forEach(m => sessionPersistentExcludeTmdbIds.add(m.tmdb_id));


    let exitMovieMenu = false;
    while (!exitMovieMenu) {
        console.log(chalk.bold.blue("\n--- Movie Recommender Menu ---"));
        console.log("1. Get Movie Recommendations (One by One)");
        console.log("2. Rate a Movie (Search & Rate)");
        console.log("3. Search and View Movie Details");
        console.log("4. Manage My Movie Preferences");
        console.log("0. Back to Main Menu");

        const choice = (await ask(chalk.green("Choose an option: "))).trim();

        switch (choice) {
            case '1': {
                console.log(chalk.cyan("\nFetching movie recommendations..."));
                // Use the sessionPersistentExcludeTmdbIds which includes already rated + session liked/disliked
                const recommendations = await getMovieRecommendationsForUser(
                    currentUser,
                    new Set(sessionPersistentExcludeTmdbIds) // Pass a copy to avoid direct modification by recommender
                );
                // The present... function will modify its own sessionShownTmdbIds,
                // and if a movie is liked/disliked, it will add to our sessionPersistentExcludeTmdbIds
                await presentMovieRecommendationsOneByOne(currentUser, recommendations, sessionPersistentExcludeTmdbIds);
                break;
            }
            // Cases 2, 3, 4, 0 remain largely the same as the previous complete file
            // Ensure that if a movie is rated in Case 2, its TMDB ID is added to sessionPersistentExcludeTmdbIds
            case '2': {
                const tmdbMovieFromSearch = await searchAndSelectMovie();
                if (tmdbMovieFromSearch) {
                    const detailedTmdbMovieData = await getTMDBMovieDetails(tmdbMovieFromSearch.id);
                    if (!detailedTmdbMovieData) { /* ... */ break; }
                    const movieInDb = await saveMovie(detailedTmdbMovieData);
                    if (!movieInDb) { /* ... */ break; }
                    displayMovieSummary(movieInDb);
                    const ratingStr = (await ask(chalk.green(`Rate "${movieInDb.title}" (1-5, or 0): `))).trim();
                    const rating = parseInt(ratingStr);
                    if (!isNaN(rating) && rating >= 1 && rating <= 5) {
                        await saveUserMovieRating(currentUser.id, movieInDb.id, rating);
                        console.log(chalk.green(`Rated "${movieInDb.title}" ${rating} stars.`));
                        sessionPersistentExcludeTmdbIds.add(movieInDb.tmdb_id); // Add to session exclusion
                    } else if (rating !== 0) { /* ... */ }
                }
                break;
            }
            case '3': {
                const tmdbMovieFromSearch = await searchAndSelectMovie();
                if(tmdbMovieFromSearch) {
                    const detailedTmdbData = await getTMDBMovieDetails(tmdbMovieFromSearch.id);
                    if (!detailedTmdbData) { /* ... */ break; }
                    const movieToViewDetails = await saveMovie(detailedTmdbData);
                    if (movieToViewDetails) {
                        const interaction = await viewAndInteractWithMovieDetails(movieToViewDetails, currentUser);
                        if (interaction === 'liked' || interaction === 'disliked') {
                            sessionPersistentExcludeTmdbIds.add(movieToViewDetails.tmdb_id); // Add to session exclusion
                        }
                    } else { /* ... */ }
                }
                break;
            }
            case '4': {
                userMoviePrefs = await manageMoviePreferences(currentUser.id, userMoviePrefs);
                // After preferences change, it might be good to clear sessionPersistentExcludeTmdbIds
                // or re-fetch recommendations immediately, but for now, it persists.
                // Or, if prefs change, the next call to option 1 will use new prefs.
                break;
            }
            case '0':
                exitMovieMenu = true;
                break;
            default:
                console.log(chalk.red("Invalid option."));
        }
    }
}