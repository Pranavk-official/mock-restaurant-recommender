import type { Movie } from './types';
import type { User } from '../common/types';
import { getMovieRecommendations as getTMDBRecommendations, getPopularMovies } from '../common/tmdbService';
import type { TMDBMovie } from '../common/tmdbService';
import { saveMovie, getMovieByTmdbId, getUserMovieRatings, getGenresFromUserHighlyRatedMovies as getGenresFromUserLikedMovies } from '../db/movieDb';
import chalk from 'chalk';

const MIN_RATINGS_FOR_COLLABORATIVE = 3; // Min ratings before using TMDB recommendations

// Content-Based: Simple genre matching
async function getContentBasedRecommendations(
    user: User,
    allMoviesFromDB: Movie[], // Or fetch popular ones not yet rated highly by user
    count: number = 10
): Promise<Movie[]> {
    const likedGenres = await getGenresFromUserLikedMovies(user.id, 3.5); // User rated 3.5+/5
    if (likedGenres.length === 0) {
        console.log(chalk.blue("No specific genre preferences found from your ratings yet for content-based filtering."));
        return []; // Or fallback to general popular movies
    }
    console.log(chalk.dim(`[Content-Based] Preferred genres: ${likedGenres.join(', ')}`));

    const scoredMovies = allMoviesFromDB.map(movie => {
        let score = 0;
        movie.genres.forEach(genre => {
            if (likedGenres.includes(genre.name)) {
                score += 1; // Simple score increment for each matching genre
            }
        });
        return { movie, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

    return scoredMovies.slice(0, count).map(item => item.movie);
}


export async function getMovieRecommendationsForUser(
    user: User,
    excludeMovieTmdbIds: Set<number> = new Set(), // TMDB IDs to exclude
    count: number = Infinity // Changed default from 5 to Infinity
): Promise<Movie[]> {
    const userRatings = await getUserMovieRatings(user.id);
    const recommendations: Movie[] = [];

    // Phase 2: Collaborative Filtering (via TMDB Recommendations API)
    if (userRatings.length >= MIN_RATINGS_FOR_COLLABORATIVE) {
        console.log(chalk.cyan("\nTrying collaborative filtering (TMDB recommendations)..."));
        // Get TMDB recommendations based on user's highest-rated movies
        const sortedRatings = userRatings.sort((a: { rating: number; }, b: { rating: number; }) => b.rating - a.rating);
        
        for (const ratedMovie of sortedRatings.slice(0, 3)) { // Use top 3 rated movies as seeds
            // We need movie_tmdb_id from userRatings for this, ensure it's fetched in getUserMovieRatings
            if (!('movie_tmdb_id' in ratedMovie)) {
                 console.warn(chalk.yellow("Missing movie_tmdb_id in rating object, cannot fetch TMDB recommendations for it."));
                 continue;
            }
            const tmdbRecs = await getTMDBRecommendations((ratedMovie as any).movie_tmdb_id); // Fetch based on TMDB ID
            if (tmdbRecs && tmdbRecs.results) {
                for (const tmdbMovie of tmdbRecs.results) {
                    if (recommendations.length >= count) break;
                    if (excludeMovieTmdbIds.has(tmdbMovie.id)) continue;

                    let movieInDb = await getMovieByTmdbId(tmdbMovie.id);
                    if (!movieInDb) {
                        movieInDb = await saveMovie(tmdbMovie as TMDBMovie); // Save if not in DB
                    }
                    if (movieInDb && !recommendations.find(r => r.tmdb_id === movieInDb!.tmdb_id)) {
                        recommendations.push(movieInDb);
                        excludeMovieTmdbIds.add(movieInDb.tmdb_id); // Add to exclude for this run
                    }
                }
            }
            if (recommendations.length >= count) break;
        }
    }

    // Phase 1: Content-Based Filtering (if collaborative didn't yield enough or not applicable)
    if (recommendations.length < count && userRatings.length > 0) {
        console.log(chalk.cyan("\nTrying content-based filtering..."));
        // For simplicity, we'd fetch popular movies and filter, or use movies already in DB.
        // This part needs a source of candidate movies if `allMoviesFromDB` isn't readily available.
        // Let's assume we fetch some popular ones if our DB is small.
        const popularTmdb = await getPopularMovies();
        const candidateMovies: Movie[] = [];
        if (popularTmdb && popularTmdb.results) {
            for (const tmdbPopMovie of popularTmdb.results) {
                if (excludeMovieTmdbIds.has(tmdbPopMovie.id)) continue;
                let movieInDb = await getMovieByTmdbId(tmdbPopMovie.id);
                if (!movieInDb) movieInDb = await saveMovie(tmdbPopMovie as TMDBMovie);
                if (movieInDb) candidateMovies.push(movieInDb);
            }
        }

        const contentRecs = await getContentBasedRecommendations(user, candidateMovies, count - recommendations.length);
        for (const rec of contentRecs) {
            if (recommendations.length >= count) break;
            if (!recommendations.find(r => r.tmdb_id === rec.tmdb_id) && !excludeMovieTmdbIds.has(rec.tmdb_id)) {
                recommendations.push(rec);
                excludeMovieTmdbIds.add(rec.tmdb_id);
            }
        }
    }

    // Fallback: Popular Movies (if still not enough recommendations)
    if (recommendations.length < count) {
        console.log(chalk.cyan("\nFalling back to popular movies..."));
        const popularTmdb = await getPopularMovies();
        if (popularTmdb && popularTmdb.results) {
            for (const tmdbMovie of popularTmdb.results) {
                if (recommendations.length >= count) break;
                if (excludeMovieTmdbIds.has(tmdbMovie.id)) continue;

                let movieInDb = await getMovieByTmdbId(tmdbMovie.id);
                if (!movieInDb) {
                     movieInDb = await saveMovie(tmdbMovie as TMDBMovie);
                }
                if (movieInDb && !recommendations.find(r => r.tmdb_id === movieInDb!.tmdb_id)) {
                    recommendations.push(movieInDb);
                    excludeMovieTmdbIds.add(movieInDb.tmdb_id);
                }
            }
        }
    }
    return recommendations.slice(0, count);
}