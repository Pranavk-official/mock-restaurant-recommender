import type { TvShow, UserTvShowPreferences } from './types';
import type { User } from '../common/types';
import {
    getPopularTvShows,
    getTvShowRecommendations as getTMDBCollaborativeRecs,
    getTvShowDetails as getTMDBTvShowDetails,
} from '../common/tmdbService';
import type { TMDBTvShow as TMDBTvShowFromService } from '../common/tmdbService';

import {
    saveTvShow,
    getTvShowByTmdbId,
    getUserTvShowRatings,
} from '../db/tvShowDb';

import chalk from 'chalk';

const MIN_RATINGS_FOR_COLLABORATIVE_TV = 2; // Slightly lower threshold for TV

async function getContentBasedTvShowRecommendations(
    user: User,
    preferences: UserTvShowPreferences,
    candidateTvShows: TvShow[],
    count: number
): Promise<TvShow[]> {
    console.log(chalk.dim(`[TV Content-Based] Applying detailed preferences for ${user.name}`));

    const scoredShows = candidateTvShows
        .map(show => {
            let score = 0;
            let meetsAllHardFilters = true;

            // 1. Genre Match
            if (preferences.preferred_genres && preferences.preferred_genres.length > 0) {
                const showGenresLower = show.genres.map(g => g.name.toLowerCase());
                const preferredGenresLower = preferences.preferred_genres.map(g => g.toLowerCase());
                let genreMatchCount = 0;
                preferredGenresLower.forEach(pg => { if (showGenresLower.includes(pg)) genreMatchCount++; });
                if (genreMatchCount === 0) meetsAllHardFilters = false; else score += genreMatchCount * 5;
            } else {
                score += 2;
            }

            // 2. Language Match
            if (preferences.preferred_languages && preferences.preferred_languages.length > 0) {
                if (!show.original_language || !preferences.preferred_languages.includes(show.original_language.toLowerCase())) {
                    meetsAllHardFilters = false;
                } else {
                    score += 10;
                }
            }

            // 3. First Air Year
            if (show.first_air_date) {
                const showYear = parseInt(show.first_air_date.substring(0, 4));
                if (preferences.first_air_year_min && showYear < preferences.first_air_year_min) meetsAllHardFilters = false;
                if (preferences.first_air_year_max && showYear > preferences.first_air_year_max) meetsAllHardFilters = false;
            } else if (preferences.first_air_year_min || preferences.first_air_year_max) {
                meetsAllHardFilters = false;
            }

            // 4. Avg Episode Duration
            const avgEpisodeRunTime = show.episode_run_time && show.episode_run_time.length > 0 ? show.episode_run_time[0] : null;
            if (avgEpisodeRunTime != null) {
                if (preferences.avg_episode_duration_min != null && avgEpisodeRunTime < preferences.avg_episode_duration_min) meetsAllHardFilters = false;
                if (preferences.avg_episode_duration_max != null && avgEpisodeRunTime > preferences.avg_episode_duration_max) meetsAllHardFilters = false;
            } else if (preferences.avg_episode_duration_min != null || preferences.avg_episode_duration_max != null) {
                meetsAllHardFilters = false;
            }

            // 5. TMDB Vote Average
            if (preferences.min_imdb_rating != null && show.vote_average < preferences.min_imdb_rating) {
                 meetsAllHardFilters = false;
            }
            
            // 6. Streaming Provider (soft preference for now)
            if (preferences.preferred_streaming_providers && preferences.preferred_streaming_providers.length > 0) {
                score += 3;
            }


            if (!meetsAllHardFilters) return { show, score: 0 };
            score += 5 + (show.vote_average / 2);
            return { show, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return scoredShows.slice(0, count).map(item => item.show);
}


export async function getTvShowRecommendationsForUser(
    user: User,
    userPrefs: UserTvShowPreferences,
    excludeTvShowTmdbIds: Set<number> = new Set(),
    count: number = Infinity
): Promise<TvShow[]> {
    const userRatings = await getUserTvShowRatings(user.id);
    let recommendations: TvShow[] = [];

    // Phase 1: Content-Based
    console.log(chalk.cyan("\n[TV] Phase 1: Content-based filtering..."));
    const popularTvResponse = await getPopularTvShows();
    const candidateTvShows: TvShow[] = [];
    if (popularTvResponse && popularTvResponse.results) {
        for (const tmdbPopShow of popularTvResponse.results.slice(0, 30)) {
            if (excludeTvShowTmdbIds.has(tmdbPopShow.id)) continue;
            const detailedTmdbShow = await getTMDBTvShowDetails(tmdbPopShow.id);
            if (!detailedTmdbShow) continue;
            let showInDb = await saveTvShow(detailedTmdbShow as TMDBTvShowFromService);
            if (showInDb) candidateTvShows.push(showInDb);
        }
    }
    if (candidateTvShows.length > 0) {
        const contentRecs = await getContentBasedTvShowRecommendations(user, userPrefs, candidateTvShows, count);
        for (const rec of contentRecs) {
            if (recommendations.length >= count) break;
            if (!recommendations.some(r => r.tmdb_id === rec.tmdb_id)) {
                recommendations.push(rec);
                excludeTvShowTmdbIds.add(rec.tmdb_id);
            }
        }
    }

    // Phase 2: Collaborative
    if (recommendations.length < count && userRatings.length >= MIN_RATINGS_FOR_COLLABORATIVE_TV) {
        console.log(chalk.cyan("\n[TV] Phase 2: Collaborative filtering..."));
        const sortedRatings = [...userRatings].sort((a, b) => b.rating - a.rating);
        for (const ratedShow of sortedRatings.slice(0, 2)) {
            if (recommendations.length >= count) break;
            const tmdbCollabRecs = await getTMDBCollaborativeRecs(ratedShow.tv_show_tmdb_id);
            if (tmdbCollabRecs && tmdbCollabRecs.results) {
                for (const tmdbCollabShow of tmdbCollabRecs.results) {
                    if (recommendations.length >= count || excludeTvShowTmdbIds.has(tmdbCollabShow.id)) continue;
                    const detailedCollabShow = await getTMDBTvShowDetails(tmdbCollabShow.id);
                    if (!detailedCollabShow) continue;
                    let showInDb = await saveTvShow(detailedCollabShow as TMDBTvShowFromService);
                    if (showInDb && !recommendations.some(r => r.tmdb_id === showInDb!.tmdb_id)) {
                        recommendations.push(showInDb);
                        excludeTvShowTmdbIds.add(showInDb.tmdb_id);
                    }
                }
            }
        }
    }

    // Phase 3: Fallback to Popular
    if (recommendations.length < count && popularTvResponse && popularTvResponse.results) {
        console.log(chalk.cyan("\n[TV] Phase 3: Fallback to popular..."));
        for (const tmdbPopShow of popularTvResponse.results) {
            if (recommendations.length >= count || excludeTvShowTmdbIds.has(tmdbPopShow.id)) continue;
            let showInDb = await getTvShowByTmdbId(tmdbPopShow.id); // Might already be detailed from phase 1
            if (!showInDb) {
                const detailedFallbackShow = await getTMDBTvShowDetails(tmdbPopShow.id);
                if (detailedFallbackShow) showInDb = await saveTvShow(detailedFallbackShow as TMDBTvShowFromService);
            }
            if (showInDb && !recommendations.some(r => r.tmdb_id === showInDb!.tmdb_id)) {
                recommendations.push(showInDb);
                excludeTvShowTmdbIds.add(showInDb.tmdb_id);
            }
        }
    }
    return recommendations.slice(0, count);
}