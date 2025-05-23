// src/cli/movieCli.ts
import chalk from 'chalk';
import readline from 'readline';
import type { User } from '../common/types';
import type { Movie, UserMoviePreferences } from '../movies/types';
import {
    getMovieDetails as getTMDBMovieDetails,
    searchMovies as searchTMDBMovies,
    getPosterUrl,
    getMovieGenreList, // To show available genres when setting preferences
} from '../common/tmdbService';
import type { TMDBMovie as TMDBMovieFromService } from '../common/tmdbService';
import {
    saveMovie, // Saves/updates a movie in our DB, returns our internal Movie type
    getMovieByTmdbId,
    saveUserMovieRating,
    getRatedMovieIdsByUser, // Gets OUR internal DB IDs of rated movies
    getUserMoviePreferences,
    saveUserMoviePreferences,
    getMovieByOurId // Gets a movie by our internal DB ID
} from '../db/movieDb';
import { getMovieRecommendationsForUser } from '../movies/recommender';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

// --- Display Functions ---
function displayMovieSummary(movie: Movie): void { // Expects our internal Movie type
    console.log(chalk.magenta("\n----------------------------------------"));
    console.log(chalk.bold.yellowBright(`✨ ${movie.title} (${movie.release_date?.substring(0,4) || 'N/A'}) ✨`));
    console.log(chalk.dim(`   Our DB ID: ${movie.id} | TMDB ID: ${movie.tmdb_id}`));
    console.log(`   Rating: ⭐ ${movie.vote_average?.toFixed(1)}/10 (${movie.vote_count} votes)`);
    const genres = movie.genres?.map(g => g.name).join(', ') || 'N/A';
    console.log(`   Genres: ${genres}`);
    console.log(`   Runtime: ${movie.runtime ? `${movie.runtime} min` : 'N/A'}`);
    // Briefly show overview
    if (movie.overview) {
        console.log(chalk.gray(`   Overview: ${movie.overview.substring(0, 120)}...`));
    }
    const poster = getPosterUrl(movie.poster_path, 'w154');
    if (poster) console.log(chalk.dim(`   Poster: ${poster}`));
    console.log(chalk.magenta("----------------------------------------"));
}

async function viewAndInteractWithMovieDetails(
    movieToView: Movie, // Expects our internal Movie object
    currentUser: User
): Promise<'liked' | 'disliked' | 'skipped' | 'quit'> {
    // Fetch fresh, rich details from TMDB using the tmdb_id from our Movie object
    console.log(chalk.cyan(`\nFetching latest full details for "${movieToView.title}" (TMDB ID: ${movieToView.tmdb_id})...`));
    const tmdbDetails = await getTMDBMovieDetails(movieToView.tmdb_id);

    if (!tmdbDetails) {
        console.log(chalk.red("Could not fetch full movie details from TMDB. Showing cached info if available."));
        // Fallback to displaying the movieToView (our cached version)
        // This section could be enhanced to show more details from 'movieToView' itself
        displayMovieSummary(movieToView); // Show summary of what we have
    } else {
        // Save/update the fetched TMDB details into our database.
        // saveMovie returns our internal Movie type, possibly updated.
        const updatedMovieInDb = await saveMovie(tmdbDetails);
        if (!updatedMovieInDb) {
            console.log(chalk.red("Error updating movie details in our database. Displaying potentially stale info."));
            displayMovieSummary(movieToView); // Show original if update failed
        } else {
            // Display full details using the fresh data from tmdbDetails
            // (or updatedMovieInDb which should reflect tmdbDetails)
            console.log(chalk.magenta("\n🎬 MOVIE DETAILS 🎬"));
            console.log(chalk.bold.yellowBright(`${updatedMovieInDb.title} (${updatedMovieInDb.release_date?.substring(0,4)})`));
            console.log(chalk.dim(`   Our DB ID: ${updatedMovieInDb.id} | TMDB ID: ${updatedMovieInDb.tmdb_id}`));
            if(updatedMovieInDb.imdb_id) console.log(`   IMDb ID: ${updatedMovieInDb.imdb_id}`);
            console.log(`   Tagline: ${tmdbDetails.tagline || 'N/A'}`); // Use tmdbDetails for non-DB stored fields
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
                const providers = tmdbDetails["watch/providers"].results["US"]; // Example region
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


    // Interaction loop after showing details
    // Use movieToView.id (our internal DB ID) for rating
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
    recommendations: Movie[], // Array of our internal Movie objects
    userMoviePrefs: UserMoviePreferences // Not directly used here, but good for context
) {
    if (recommendations.length === 0) {
        console.log(chalk.yellow("No movie recommendations available based on current criteria."));
        console.log(chalk.yellow("Try rating more movies (Option 2) or adjusting your preferences (Option 4)."));
        return;
    }
    console.log(chalk.bold.yellowBright("\nHere are your movie recommendations, one by one:"));

    const interactedWithTmdbIdsInSession = new Set<number>();

    for (const movie of recommendations) {
        if (!movie || !movie.id || !movie.tmdb_id) {
            console.warn(chalk.yellow("[CLI] Skipping invalid movie object in recommendations list."));
            continue;
        }
        if (interactedWithTmdbIdsInSession.has(movie.tmdb_id)) {
            // console.log(chalk.dim(`[CLI] Already interacted with TMDB ID ${movie.tmdb_id} in this session. Skipping duplicate appearance.`));
            continue;
        }

        displayMovieSummary(movie); // Displays our internal Movie type

        let interactionResult: 'liked' | 'disliked' | 'skipped' | 'quit' | 'details' = 'skipped';

        interactionLoop: while(true) {
            const action = (await ask(chalk.cyan("Choose: [L]ike (5⭐), [D]islike (1⭐), [V]iew Details, [N]ext, [Q]uit to menu: "))).toLowerCase();
            switch (action) {
                case 'l':
                    await saveUserMovieRating(currentUser.id, movie.id, 5);
                    console.log(chalk.green(`You liked "${movie.title}"!`));
                    interactionResult = 'liked';
                    break interactionLoop;
                case 'd':
                    await saveUserMovieRating(currentUser.id, movie.id, 1);
                    console.log(chalk.red(`You disliked "${movie.title}".`));
                    interactionResult = 'disliked';
                    break interactionLoop;
                case 'v':
                    interactionResult = await viewAndInteractWithMovieDetails(movie, currentUser);
                    // The result from viewAndInteract... determines if we break the outer loop or continue
                    // If 'quit', we break outer. If 'liked'/'disliked'/'skipped', we also break outer (to next movie).
                    break interactionLoop;
                case 'n':
                    interactionResult = 'skipped';
                    break interactionLoop;
                case 'q':
                    interactionResult = 'quit';
                    break interactionLoop;
                default:
                    console.log(chalk.yellow("Invalid action. Please choose from L, D, V, N, Q."));
            }
        }

        interactedWithTmdbIdsInSession.add(movie.tmdb_id);

        if (interactionResult === 'quit') {
            console.log(chalk.blue("Returning to Movie Menu..."));
            return; // Exit the entire recommendation presentation
        }
        // For 'liked', 'disliked', or 'skipped' (from initial prompt or after details),
        // the loop continues to the next movie in the `recommendations` array.
    }
    console.log(chalk.blue("\nFinished presenting available recommendations for this batch."));
}

async function searchAndSelectMovie(): Promise<TMDBMovieFromService | null> {
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

    if (displayableResults.length === 0) { // Should be caught by earlier check, but good to have
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

async function manageMoviePreferences(userId: number, currentPrefs?: UserMoviePreferences): Promise<UserMoviePreferences> {
    console.log(chalk.cyan("\n--- Manage Movie Preferences ---"));
    let prefs: UserMoviePreferences = currentPrefs || { user_id: userId }; // Start with existing or new object

    const allGenres = await getMovieGenreList(); // Fetch available genres from TMDB
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

    // For provider selection, you might list available ones from getMovieWatchProviders()
    const providersStr = (await ask(chalk.green(`Preferred Streaming Providers (comma-sep names, e.g. Netflix,Hulu, current: ${prefs.preferred_streaming_providers?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_streaming_providers = providersStr ? providersStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    await saveUserMoviePreferences(prefs);
    console.log(chalk.green("Movie preferences updated successfully!"));
    return prefs;
}

export async function runMovieCLI(currentUser: User): Promise<void> {
    let userMoviePrefs = await getUserMoviePreferences(currentUser.id);
    if (!userMoviePrefs) {
        console.log(chalk.yellow("No movie preferences found for you yet. Using general recommendations."));
        console.log(chalk.yellow("You can set your preferences via Option 4."));
        userMoviePrefs = { user_id: currentUser.id }; // Initialize with user_id for the recommender
    }

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
                if (Object.keys(userMoviePrefs).length <= 1) { // Only user_id means no real prefs set
                    console.log(chalk.yellow("Your movie preferences are not set. Results may be very general."));
                    console.log(chalk.yellow("Please set your preferences (Option 4) for better results."));
                }

                const ratedMovieOurDbIds = await getRatedMovieIdsByUser(currentUser.id);
                const ratedMoviesInDb = (await Promise.all(ratedMovieOurDbIds.map(id => getMovieByOurId(id)))).filter(m => m) as Movie[];
                const excludeTmdbIds = new Set(ratedMoviesInDb.map(m => m.tmdb_id));

                // userMoviePrefs is not directly passed to getMovieRecommendationsForUser based on its current signature.
                // If the recommender needs preferences, it should fetch them internally or its signature should be updated.
                // For now, we pass excludeTmdbIds as the second argument.
                const recommendations = await getMovieRecommendationsForUser(currentUser, excludeTmdbIds);
                await presentMovieRecommendationsOneByOne(currentUser, recommendations, userMoviePrefs);
                break;
            }
            case '2': { // Rate a Movie
                const tmdbMovieFromSearch = await searchAndSelectMovie(); // Returns TMDBMovieFromService
                if (tmdbMovieFromSearch) {
                    // Fetch full details from TMDB to ensure we have everything before saving
                    const detailedTmdbMovieData = await getTMDBMovieDetails(tmdbMovieFromSearch.id);
                    if (!detailedTmdbMovieData) {
                        console.log(chalk.red("Could not fetch full details for the selected movie. Cannot rate."));
                        break;
                    }
                    // Save (or update) the movie to our local DB. saveMovie returns our internal Movie type.
                    const movieInDb = await saveMovie(detailedTmdbMovieData);
                    if (!movieInDb) {
                         console.log(chalk.red("Error saving movie to our database. Cannot rate."));
                         break;
                    }
                    
                    displayMovieSummary(movieInDb); // Display summary of our internal Movie object

                    const ratingStr = (await ask(chalk.green(`Rate "${movieInDb.title}" (1-5 stars, or 0 to skip): `))).trim();
                    const rating = parseInt(ratingStr);
                    if (!isNaN(rating) && rating >= 1 && rating <= 5) {
                        await saveUserMovieRating(currentUser.id, movieInDb.id, rating); // Use our internal movieInDb.id
                        console.log(chalk.green(`Rated "${movieInDb.title}" ${rating} stars. Thank you!`));
                    } else if (rating !== 0) {
                        console.log(chalk.yellow("Invalid rating. Please enter a number between 1 and 5, or 0 to skip."));
                    }
                }
                break;
            }
            case '3': { // Search and View Movie Details
                const tmdbMovieFromSearch = await searchAndSelectMovie(); // Returns TMDBMovieFromService
                if(tmdbMovieFromSearch) {
                    // Fetch its full details and save/update it in our DB to get our internal Movie object
                    const detailedTmdbData = await getTMDBMovieDetails(tmdbMovieFromSearch.id);
                    if (!detailedTmdbData) {
                        console.log(chalk.red("Could not fetch details for the selected movie."));
                        break;
                    }
                    const movieToViewDetails = await saveMovie(detailedTmdbData); // This is our internal Movie type
                    
                    if (movieToViewDetails) {
                        await viewAndInteractWithMovieDetails(movieToViewDetails, currentUser);
                    } else {
                        console.log(chalk.red("Could not process details for the selected movie after fetching."));
                    }
                }
                break;
            }
            case '4': { // Manage Preferences
                userMoviePrefs = await manageMoviePreferences(currentUser.id, userMoviePrefs);
                break;
            }
            case '0':
                exitMovieMenu = true;
                break;
            default:
                console.log(chalk.red("Invalid option. Please try again."));
        }
    }
}