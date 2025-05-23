// src/cli/tvShowCli.ts
import chalk from 'chalk';
import readline from 'readline';
import type { User } from '../common/types';
import type { TvShow, UserTvShowPreferences } from '../tvshows/types'; // Ensure these types are correctly defined
import {
    getTvShowDetails as getTMDBTvShowDetails,
    getTvShowSeasonDetails as getTMDBTvShowSeasonDetails,
    searchTvShows as searchTMDBTvShows,
    getPosterUrl,
    getStillUrl,
    getTvShowGenreList,
} from '../common/tmdbService';
import type { TMDBTvShow as TMDBTvShowFromService, TMDBFullSeason, TMDBEpisodeSummary } from '../common/tmdbService';
import {
    saveTvShow,
    getTvShowByTmdbId,
    saveUserTvShowRating,
    getRatedTvShowIdsByUser,
    getUserTvShowPreferences,
    saveUserTvShowPreferences,
    getTvShowByOurId
} from '../db/tvShowDb';
import { getTvShowRecommendationsForUser } from '../tvshows/recommender';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

// --- Display Functions ---
function displayTvShowSummary(show: TvShow): void {
    console.log(chalk.magenta("\n----------------------------------------"));
    console.log(chalk.bold.yellowBright(`📺 ${show.name} (${show.first_air_date?.substring(0,4) || 'N/A'}) ✨`));
    console.log(chalk.dim(`   Our DB ID: ${show.id} | TMDB ID: ${show.tmdb_id}`));
    console.log(`   Rating: ⭐ ${show.vote_average?.toFixed(1)}/10 (${show.vote_count} votes)`);
    const genres = show.genres?.map(g => g.name).join(', ') || 'N/A';
    console.log(`   Genres: ${genres}`);
    const avgRuntime = show.episode_run_time && show.episode_run_time.length > 0 ? show.episode_run_time[0] : null;
    console.log(`   Avg Ep Runtime: ${avgRuntime ? `${avgRuntime} min` : 'N/A'}`);
    if (show.overview) {
        console.log(chalk.gray(`   Overview: ${show.overview.substring(0, 120)}...`));
    }
    const poster = getPosterUrl(show.poster_path, 'w154');
    if (poster) console.log(chalk.dim(`   Poster: ${poster}`));
    console.log(chalk.magenta("----------------------------------------"));
}

async function viewAndInteractWithTvShowDetails(
    showToView: TvShow, // Expects our internal TvShow object
    currentUser: User
): Promise<'liked' | 'disliked' | 'skipped' | 'quit'> {
    console.log(chalk.cyan(`\nFetching latest full details for "${showToView.name}" (TMDB ID: ${showToView.tmdb_id})...`));
    const tmdbDetails = await getTMDBTvShowDetails(showToView.tmdb_id);

    if (!tmdbDetails) {
        console.log(chalk.red("Could not fetch full TV show details from TMDB. Showing cached info."));
        displayTvShowSummary(showToView);
    } else {
        const updatedShowInDb = await saveTvShow(tmdbDetails);
        if (!updatedShowInDb) {
            console.log(chalk.red("Error updating TV show details in our database. Displaying potentially stale info."));
            displayTvShowSummary(showToView);
        } else {
            console.log(chalk.magenta("\n🎬 TV SHOW DETAILS 🎬"));
            console.log(chalk.bold.yellowBright(`${updatedShowInDb.name} (${updatedShowInDb.first_air_date?.substring(0,4)})`));
            console.log(chalk.dim(`   Our DB ID: ${updatedShowInDb.id} | TMDB ID: ${updatedShowInDb.tmdb_id}`));
            if(updatedShowInDb.imdb_id) console.log(`   IMDb ID: ${updatedShowInDb.imdb_id}`);
            console.log(`   Tagline: ${tmdbDetails.tagline || 'N/A'}`);
            const avgRuntime = updatedShowInDb.episode_run_time && updatedShowInDb.episode_run_time.length > 0 ? updatedShowInDb.episode_run_time[0] : null;
            console.log(`   Avg Ep Runtime: ${avgRuntime ? `${avgRuntime} min` : 'N/A'}`);
            console.log(`   Seasons: ${updatedShowInDb.number_of_seasons || 'N/A'}`);
            console.log(`   Status: ${tmdbDetails.status || 'N/A'}`);
            console.log(`   Rating: ⭐ ${updatedShowInDb.vote_average?.toFixed(1)}/10 (${updatedShowInDb.vote_count} votes)`);
            console.log(`   Genres: ${updatedShowInDb.genres?.map(g => g.name).join(', ') || 'N/A'}`);
            console.log(chalk.cyan("\n--- Overview ---"));
            console.log(updatedShowInDb.overview || 'N/A');

            if (tmdbDetails.credits?.cast && tmdbDetails.credits.cast.length > 0) {
                console.log(chalk.cyan("\n--- Main Cast (Top 5) ---"));
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
                    console.log(chalk.gray("   No provider information found for US region for this TV show."));
                }
            }
             if(tmdbDetails.reviews?.results && tmdbDetails.reviews.results.length > 0) {
                console.log(chalk.cyan("\n--- Reviews (Top 1) ---"));
                const review = tmdbDetails.reviews.results[0]!;
                console.log(`   Author: ${review.author}`);
                console.log(`   "${review.content.substring(0,250)}..."`);
                if(review.url) console.log(chalk.dim(`      Read more: ${review.url}`));
            }

            if (tmdbDetails.seasons && tmdbDetails.seasons.length > 0) {
                console.log(chalk.cyan("\n--- Seasons ---"));
                const regularSeasons = tmdbDetails.seasons.filter(s => s.season_number > 0);
                regularSeasons.slice(0, 5).forEach(s => console.log(`  S${s.season_number}: ${s.name} (${s.episode_count} episodes) - Air Date: ${s.air_date || 'N/A'}`));
                if (regularSeasons.length > 5) console.log(chalk.dim("  ...and more seasons."));
                
                const seasonChoiceStr = (await ask(chalk.green("View episodes for season number (or 0 to skip): "))).trim();
                const seasonNumberToView = parseInt(seasonChoiceStr);
                if (!isNaN(seasonNumberToView) && seasonNumberToView > 0 && regularSeasons.some(s => s.season_number === seasonNumberToView)) {
                    console.log(chalk.cyan(`Fetching S${seasonNumberToView} details...`));
                    const fullSeasonDetails: TMDBFullSeason | null = await getTMDBTvShowSeasonDetails(updatedShowInDb.tmdb_id, seasonNumberToView);
                    if (fullSeasonDetails && fullSeasonDetails.episodes) {
                        console.log(chalk.yellowBright(`\n--- Season ${seasonNumberToView}: ${fullSeasonDetails.name} - Episodes (Top 10) ---`));
                        fullSeasonDetails.episodes.slice(0, 10).forEach((ep: TMDBEpisodeSummary) => {
                            console.log(`  E${ep.episode_number}: ${ep.name} (Air: ${ep.air_date || 'TBA'}, Rating: ${ep.vote_average.toFixed(1)})`);
                            if(ep.overview) console.log(chalk.dim(`    ${ep.overview.substring(0,100)}...`));
                        });
                        if (fullSeasonDetails.episodes.length > 10) console.log(chalk.dim("    ...and more episodes."));
                    } else {
                        console.log(chalk.yellow(`Could not fetch episodes for S${seasonNumberToView}.`));
                    }
                }
            }
            const poster = getPosterUrl(updatedShowInDb.poster_path, 'w342');
            if (poster) console.log(chalk.cyan(`\nPoster: ${poster}`));
            console.log(chalk.magenta("----------------------------------------"));
        }
    }

    const internalShowIdToRate = showToView.id;
    const showTitleToRate = showToView.name;

    while (true) {
        const action = (await ask(chalk.cyan("Action after details: [L]ike (5⭐), [D]islike (1⭐), [N]ext item, [Q]uit to menu: "))).toLowerCase();
        if (action === 'l') {
            await saveUserTvShowRating(currentUser.id, internalShowIdToRate, 5);
            console.log(chalk.green(`You liked "${showTitleToRate}"!`));
            return 'liked';
        } else if (action === 'd') {
            await saveUserTvShowRating(currentUser.id, internalShowIdToRate, 1);
            console.log(chalk.red(`You disliked "${showTitleToRate}".`));
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

async function presentTvShowRecommendationsOneByOne(
    currentUser: User,
    initialRecommendations: TvShow[],
    persistentExcludeTmdbIds: Set<number> // This set is updated if user likes/dislikes
) {
    if (initialRecommendations.length === 0) {
        console.log(chalk.yellow("No TV show recommendations available based on current criteria."));
        console.log(chalk.yellow("Try rating more shows (Option 2) or adjusting your preferences (Option 4)."));
        return;
    }
    console.log(chalk.bold.yellowBright("\nHere are your TV show recommendations, one by one:"));

    let currentRecommendationQueue = [...initialRecommendations];
    const sessionShownTmdbIds = new Set<number>();

    while (currentRecommendationQueue.length > 0) {
        const show = currentRecommendationQueue.shift();

        if (!show || !show.id || !show.tmdb_id) {
            console.warn(chalk.yellow("[CLI] Skipping invalid TV show object in recommendations queue."));
            continue;
        }
        if (persistentExcludeTmdbIds.has(show.tmdb_id) || sessionShownTmdbIds.has(show.tmdb_id)) {
            continue;
        }

        displayTvShowSummary(show);
        sessionShownTmdbIds.add(show.tmdb_id);

        let interactionResult: 'liked' | 'disliked' | 'skipped' | 'quit' = 'skipped';

        interactionLoop: while(true) {
            const action = (await ask(chalk.cyan("Choose: [L]ike (5⭐), [D]islike (1⭐), [V]iew Details, [N]ext, [Q]uit to menu: "))).toLowerCase();
            switch (action) {
                case 'l':
                    await saveUserTvShowRating(currentUser.id, show.id, 5);
                    console.log(chalk.green(`You liked "${show.name}"!`));
                    persistentExcludeTmdbIds.add(show.tmdb_id);
                    interactionResult = 'liked';
                    break interactionLoop;
                case 'd':
                    await saveUserTvShowRating(currentUser.id, show.id, 1);
                    console.log(chalk.red(`You disliked "${show.name}".`));
                    persistentExcludeTmdbIds.add(show.tmdb_id);
                    interactionResult = 'disliked';
                    break interactionLoop;
                case 'v':
                    interactionResult = await viewAndInteractWithTvShowDetails(show, currentUser);
                    if (interactionResult === 'liked' || interactionResult === 'disliked') {
                        persistentExcludeTmdbIds.add(show.tmdb_id);
                    }
                    break interactionLoop;
                case 'n':
                    interactionResult = 'skipped';
                    break interactionLoop;
                case 'q':
                    interactionResult = 'quit';
                    break interactionLoop;
                default:
                    console.log(chalk.yellow("Invalid action."));
            }
        }

        if (interactionResult === 'quit') {
            console.log(chalk.blue("Returning to TV Show Menu..."));
            return;
        }
    }

    if (currentRecommendationQueue.length === 0) {
        console.log(chalk.blue("\nFinished presenting all available recommendations from this list."));
    }
}

async function searchAndSelectTvShow(): Promise<TMDBTvShowFromService | null> {
    const query = (await ask(chalk.green("Search for a TV show title: "))).trim();
    if (!query) return null;

    const searchResults = await searchTMDBTvShows(query);
    if (!searchResults || searchResults.results.length === 0) {
        console.log(chalk.yellow("No TV shows found for your search."));
        return null;
    }

    console.log(chalk.cyan("\nSearch Results (top 10):"));
    const displayableResults = searchResults.results.slice(0, 10);
    displayableResults.forEach((show, index) => {
        console.log(`  ${index + 1}. ${show.name} (${show.first_air_date?.substring(0,4) || 'N/A'}) [TMDB ID: ${show.id}]`);
    });
     if (displayableResults.length === 0) {
        console.log(chalk.yellow("No displayable search results."));
        return null;
    }
    
    let showIndex = -1;
    while(true) {
        const choice = (await ask(chalk.green("Select a show by number (or 0 to cancel): "))).trim();
        if (choice === '0') return null;
        const parsedChoice = parseInt(choice);
        if (!isNaN(parsedChoice) && parsedChoice >= 1 && parsedChoice <= displayableResults.length) {
            showIndex = parsedChoice - 1;
            break;
        }
        console.log(chalk.red("Invalid selection."));
    }
    return displayableResults[showIndex] ?? null;
}

async function manageTvShowPreferences(userId: number, currentPrefs?: UserTvShowPreferences): Promise<UserTvShowPreferences> {
    console.log(chalk.cyan("\n--- Manage TV Show Preferences ---"));
    let prefs: UserTvShowPreferences = currentPrefs || { user_id: userId };

    const allGenres = await getTvShowGenreList();
    if (allGenres.length > 0) {
        console.log(chalk.dim("Hint: Available TV genres: " + allGenres.slice(0,10).map(g => g.name).join(', ') + (allGenres.length > 10 ? ", ..." : "")));
    }

    const genresStr = (await ask(chalk.green(`Preferred Genres (comma-sep, current: ${prefs.preferred_genres?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_genres = genresStr ? genresStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    const langsStr = (await ask(chalk.green(`Preferred Languages (e.g., en,es,ja, current: ${prefs.preferred_languages?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_languages = langsStr ? langsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : undefined;

    const yearMinStr = (await ask(chalk.green(`Min First Air Year (current: ${prefs.first_air_year_min ?? 'Any'}): `))).trim();
    prefs.first_air_year_min = yearMinStr ? parseInt(yearMinStr) : undefined;
    if (isNaN(prefs.first_air_year_min!)) prefs.first_air_year_min = undefined;

    const yearMaxStr = (await ask(chalk.green(`Max First Air Year (current: ${prefs.first_air_year_max ?? 'Any'}): `))).trim();
    prefs.first_air_year_max = yearMaxStr ? parseInt(yearMaxStr) : undefined;
    if (isNaN(prefs.first_air_year_max!)) prefs.first_air_year_max = undefined;

    const epDurMinStr = (await ask(chalk.green(`Min Avg Ep Duration (minutes, current: ${prefs.avg_episode_duration_min ?? 'Any'}): `))).trim();
    prefs.avg_episode_duration_min = epDurMinStr ? parseInt(epDurMinStr) : undefined;
    if (isNaN(prefs.avg_episode_duration_min!)) prefs.avg_episode_duration_min = undefined;

    const epDurMaxStr = (await ask(chalk.green(`Max Avg Ep Duration (minutes, current: ${prefs.avg_episode_duration_max ?? 'Any'}): `))).trim();
    prefs.avg_episode_duration_max = epDurMaxStr ? parseInt(epDurMaxStr) : undefined;
    if (isNaN(prefs.avg_episode_duration_max!)) prefs.avg_episode_duration_max = undefined;
    
    const tmdbRatingStr = (await ask(chalk.green(`Min TMDB Rating (0-10, current: ${prefs.min_imdb_rating ?? 'Any'}): `))).trim();
    prefs.min_imdb_rating = tmdbRatingStr ? parseFloat(tmdbRatingStr) : undefined;
    if (isNaN(prefs.min_imdb_rating!)) prefs.min_imdb_rating = undefined;

    const providersStr = (await ask(chalk.green(`Preferred Streaming Providers (comma-sep, current: ${prefs.preferred_streaming_providers?.join(', ') || 'Any'}): `))).trim();
    prefs.preferred_streaming_providers = providersStr ? providersStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    await saveUserTvShowPreferences(prefs);
    console.log(chalk.green("TV Show preferences updated successfully!"));
    return prefs;
}


export async function runTvShowCLI(currentUser: User): Promise<void> {
    let userTvShowPrefs = await getUserTvShowPreferences(currentUser.id);
    if (!userTvShowPrefs) {
        console.log(chalk.yellow("No TV show preferences found for you yet. Using general recommendations."));
        console.log(chalk.yellow("You can set your preferences via Option 4."));
        userTvShowPrefs = { user_id: currentUser.id };
    }

    const sessionPersistentExcludeTmdbIds = new Set<number>();
    const ratedTvShowOurDbIds = await getRatedTvShowIdsByUser(currentUser.id);
    const ratedTvShowsInDb = (await Promise.all(ratedTvShowOurDbIds.map(id => getTvShowByOurId(id)))).filter(s => s) as TvShow[];
    ratedTvShowsInDb.forEach(s => sessionPersistentExcludeTmdbIds.add(s.tmdb_id));

    let exitTvMenu = false;
    while (!exitTvMenu) {
        console.log(chalk.bold.blue("\n--- TV Show Recommender Menu ---"));
        console.log("1. Get TV Show Recommendations (One by One)");
        console.log("2. Rate a TV Show (Search & Rate)");
        console.log("3. Search and View TV Show Details");
        console.log("4. Manage My TV Show Preferences");
        console.log("0. Back to Main Menu");

        const choice = (await ask(chalk.green("Choose an option: "))).trim();

        switch (choice) {
            case '1': {
                console.log(chalk.cyan("\nFetching TV show recommendations..."));
                 if (Object.keys(userTvShowPrefs).length <= 1) {
                    console.log(chalk.yellow("Your TV show preferences are not set. Results may be very general."));
                    console.log(chalk.yellow("Please set your preferences (Option 4) for better results."));
                }
                const recommendations = await getTvShowRecommendationsForUser(
                    currentUser,
                    userTvShowPrefs,
                    new Set(sessionPersistentExcludeTmdbIds)
                );
                await presentTvShowRecommendationsOneByOne(currentUser, recommendations, sessionPersistentExcludeTmdbIds);
                break;
            }
            case '2': {
                const tmdbShowFromSearch = await searchAndSelectTvShow();
                if (tmdbShowFromSearch) {
                    const detailedTmdbShowData = await getTMDBTvShowDetails(tmdbShowFromSearch.id);
                    if (!detailedTmdbShowData) { console.log(chalk.red("Could not fetch full details.")); break; }
                    const showInDb = await saveTvShow(detailedTmdbShowData);
                    if (!showInDb) { console.log(chalk.red("Error saving show. Cannot rate.")); break; }
                    
                    displayTvShowSummary(showInDb);
                    const ratingStr = (await ask(chalk.green(`Rate "${showInDb.name}" (1-5 stars, or 0 to skip): `))).trim();
                    const rating = parseInt(ratingStr);
                    if (!isNaN(rating) && rating >= 1 && rating <= 5) {
                        await saveUserTvShowRating(currentUser.id, showInDb.id, rating);
                        console.log(chalk.green(`Rated "${showInDb.name}" ${rating} stars.`));
                        sessionPersistentExcludeTmdbIds.add(showInDb.tmdb_id);
                    } else if (rating !== 0) {
                         console.log(chalk.yellow("Invalid rating."));
                    }
                }
                break;
            }
            case '3': {
                const tmdbShowFromSearch = await searchAndSelectTvShow();
                if(tmdbShowFromSearch) {
                    const detailedTmdbData = await getTMDBTvShowDetails(tmdbShowFromSearch.id);
                    if (!detailedTmdbData) { console.log(chalk.red("Could not fetch details.")); break; }
                    const showToViewDetails = await saveTvShow(detailedTmdbData);
                    
                    if (showToViewDetails) {
                        const interaction = await viewAndInteractWithTvShowDetails(showToViewDetails, currentUser);
                         if (interaction === 'liked' || interaction === 'disliked') {
                            sessionPersistentExcludeTmdbIds.add(showToViewDetails.tmdb_id);
                        }
                    } else {
                        console.log(chalk.red("Could not process details."));
                    }
                }
                break;
            }
            case '4': {
                userTvShowPrefs = await manageTvShowPreferences(currentUser.id, userTvShowPrefs);
                break;
            }
            case '0':
                exitTvMenu = true;
                break;
            default:
                console.log(chalk.red("Invalid option. Please try again."));
        }
    }
}