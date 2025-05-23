import { getDB, type User } from './setup';
import { mockUserMoviePreferences } from '../movies/mockUserPreference';
import type { Movie, UserMovieRating, UserMoviePreferences } from '../movies/types';
// Use a clear alias for the type imported from tmdbService to avoid confusion with your internal Movie type
import type { TMDBMovie as TMDBMovieFromService } from '../common/tmdbService';
import { mapMovieGenreIdsToObjects } from '../common/tmdbService'; // Import helper
import type { Genre } from '../common/types';
import chalk from 'chalk';

// Helper to ensure movieData has full genre objects before saving
async function ensureFullMovieGenreObjects(movieData: TMDBMovieFromService): Promise<Genre[]> {
    // If 'genres' (full objects) is already present and populated, use it
    if (movieData.genres && movieData.genres.length > 0) {
        return movieData.genres;
    }
    // If only 'genre_ids' is present, map them to full genre objects
    if (movieData.genre_ids && movieData.genre_ids.length > 0) {
        return mapMovieGenreIdsToObjects(movieData.genre_ids);
    }
    // If neither, return an empty array
    return [];
}

export async function saveMovie(movieDataFromService: TMDBMovieFromService): Promise<Movie | undefined> {
    const db = await getDB();
    try {
        const existingMovie = await db.get<Movie>('SELECT * FROM movies WHERE tmdb_id = ?', movieDataFromService.id);

        const fullGenres = await ensureFullMovieGenreObjects(movieDataFromService);
        // Prioritize imdb_id from external_ids if available, then direct imdb_id
        const imdbIdToSave = movieDataFromService.external_ids?.imdb_id || movieDataFromService.imdb_id || null;

        if (existingMovie) {
            // Movie exists, update it with potentially new/more complete information
            const result = await db.run(
                `UPDATE movies SET
                    title = ?, overview = ?, release_date = ?, vote_average = ?, vote_count = ?,
                    poster_path = ?, backdrop_path = ?, genres = ?, runtime = ?, original_language = ?, imdb_id = ?
                 WHERE tmdb_id = ?`,
                movieDataFromService.title,
                movieDataFromService.overview,
                movieDataFromService.release_date,
                movieDataFromService.vote_average,
                movieDataFromService.vote_count,
                movieDataFromService.poster_path,
                movieDataFromService.backdrop_path,
                JSON.stringify(fullGenres.map(g => ({ id: g.id, name: g.name }))), // Store consistent structure
                movieDataFromService.runtime === undefined ? null : movieDataFromService.runtime,
                movieDataFromService.original_language === undefined ? null : movieDataFromService.original_language,
                imdbIdToSave,
                movieDataFromService.id
            );
            if (result.changes !== undefined && result.changes > 0) {
                // console.log(chalk.dim(`[DB] Updated movie: ${movieDataFromService.title}`));
            }
            return getMovieByTmdbId(movieDataFromService.id); // Fetch the updated record
        } else {
            // Movie doesn't exist, insert new record
            const result = await db.run(
                `INSERT INTO movies (tmdb_id, title, overview, release_date, vote_average, vote_count,
                                     poster_path, backdrop_path, genres, runtime, original_language, imdb_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                movieDataFromService.id,
                movieDataFromService.title,
                movieDataFromService.overview,
                movieDataFromService.release_date,
                movieDataFromService.vote_average,
                movieDataFromService.vote_count,
                movieDataFromService.poster_path,
                movieDataFromService.backdrop_path,
                JSON.stringify(fullGenres.map(g => ({ id: g.id, name: g.name }))),
                movieDataFromService.runtime === undefined ? null : movieDataFromService.runtime,
                movieDataFromService.original_language === undefined ? null : movieDataFromService.original_language,
                imdbIdToSave
            );
            if (result.lastID) {
                // console.log(chalk.dim(`[DB] Inserted new movie: ${movieDataFromService.title}`));
                return getMovieByOurId(result.lastID);
            }
        }
    } catch (error: any) {
        // Handle unique constraint violation specifically (e.g., race condition)
        if (error.message?.includes('UNIQUE constraint failed: movies.tmdb_id')) {
            // console.warn(chalk.yellow(`[DB] Movie with TMDB ID ${movieDataFromService.id} likely already exists (constraint violation). Fetching it.`));
            return getMovieByTmdbId(movieDataFromService.id); // Attempt to fetch the existing one
        }
        console.error(chalk.red(`[DB Error] Error saving movie TMDB ID ${movieDataFromService.id} ("${movieDataFromService.title}"):`), error);
    }
    return undefined;
}

// Maps a raw database row to our internal Movie type
const mapDbRowToMovie = (row: any): Movie | undefined => {
    if (!row) return undefined;
    return {
        id: row.id, // Our internal DB ID
        tmdb_id: row.tmdb_id,
        title: row.title,
        overview: row.overview,
        release_date: row.release_date, // Stored as TEXT, will be string or null
        vote_average: row.vote_average,
        vote_count: row.vote_count,
        poster_path: row.poster_path,
        backdrop_path: row.backdrop_path,
        genres: JSON.parse(row.genres || '[]') as Genre[], // Ensure genres is always an array
        runtime: row.runtime, // Will be number or null
        original_language: row.original_language, // Will be string or null
        imdb_id: row.imdb_id, // Will be string or null
    };
};

export async function getMovieByOurId(id: number): Promise<Movie | undefined> {
    const db = await getDB();
    const row = await db.get<any>('SELECT * FROM movies WHERE id = ?', id);
    return mapDbRowToMovie(row);
}

export async function getMovieByTmdbId(tmdbId: number): Promise<Movie | undefined> {
    const db = await getDB();
    const row = await db.get<any>('SELECT * FROM movies WHERE tmdb_id = ?', tmdbId);
    return mapDbRowToMovie(row);
}

export async function getAllMoviesFromDb(): Promise<Movie[]> {
    const db = await getDB();
    const rows = await db.all<any[]>('SELECT * FROM movies');
    return rows.map(mapDbRowToMovie).filter(movie => movie !== undefined) as Movie[];
}


// --- User Movie Preferences ---
export async function saveUserMoviePreferences(prefs: UserMoviePreferences): Promise<void> {
    const db = await getDB();
    try {
        await db.run(
            `INSERT INTO user_movie_preferences (
                user_id, preferred_genres, preferred_languages, release_year_min, release_year_max,
                duration_min_minutes, duration_max_minutes, min_imdb_rating, preferred_streaming_providers
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                preferred_genres = excluded.preferred_genres,
                preferred_languages = excluded.preferred_languages,
                release_year_min = excluded.release_year_min,
                release_year_max = excluded.release_year_max,
                duration_min_minutes = excluded.duration_min_minutes,
                duration_max_minutes = excluded.duration_max_minutes,
                min_imdb_rating = excluded.min_imdb_rating,
                preferred_streaming_providers = excluded.preferred_streaming_providers
            `,
            prefs.user_id,
            prefs.preferred_genres ? JSON.stringify(prefs.preferred_genres) : null,
            prefs.preferred_languages ? JSON.stringify(prefs.preferred_languages) : null,
            prefs.release_year_min === undefined ? null : prefs.release_year_min,
            prefs.release_year_max === undefined ? null : prefs.release_year_max,
            prefs.duration_min_minutes === undefined ? null : prefs.duration_min_minutes,
            prefs.duration_max_minutes === undefined ? null : prefs.duration_max_minutes,
            prefs.min_imdb_rating === undefined ? null : prefs.min_imdb_rating,
            prefs.preferred_streaming_providers ? JSON.stringify(prefs.preferred_streaming_providers) : null
        );
        // console.log(chalk.dim(`[DB] Saved movie preferences for user ${prefs.user_id}`));
    } catch (error) {
        console.error(chalk.red(`[DB Error] Error saving movie preferences for user ${prefs.user_id}:`), error);
    }
}

export async function getUserMoviePreferences(userId: number): Promise<UserMoviePreferences | undefined> {
    const db = await getDB();
    const row = await db.get<any>( // `any` because DB returns raw row
        'SELECT * FROM user_movie_preferences WHERE user_id = ?',
        userId
    );
    if (!row) return undefined;

    // Map nulls from DB back to undefined if that's how the type is defined,
    // or keep them as null if the type expects `| null`.
    // Our UserMoviePreferences type uses `?` (optional), so `undefined` is appropriate.
    return {
        user_id: row.user_id,
        preferred_genres: row.preferred_genres ? JSON.parse(row.preferred_genres) : undefined,
        preferred_languages: row.preferred_languages ? JSON.parse(row.preferred_languages) : undefined,
        release_year_min: row.release_year_min === null ? undefined : row.release_year_min,
        release_year_max: row.release_year_max === null ? undefined : row.release_year_max,
        duration_min_minutes: row.duration_min_minutes === null ? undefined : row.duration_min_minutes,
        duration_max_minutes: row.duration_max_minutes === null ? undefined : row.duration_max_minutes,
        min_imdb_rating: row.min_imdb_rating === null ? undefined : row.min_imdb_rating,
        preferred_streaming_providers: row.preferred_streaming_providers ? JSON.parse(row.preferred_streaming_providers) : undefined,
    };
}

export async function seedInitialMoviePreferences(): Promise<void> {
    const db = await getDB();
    const users = await db.all<User[]>('SELECT id, name FROM users ORDER BY id ASC'); // Get users, assuming IDs 1,2,3...

    if (users.length === 0) {
        // console.log(chalk.yellow("[MovieDB] No users found to seed movie preferences for. Run generic user seeding first."));
        return;
    }

    // Check if preferences have already been seeded for the first user (as a proxy)
    if (users.length > 0 && users[0]) {
        const firstUserPref = await db.get('SELECT 1 FROM user_movie_preferences WHERE user_id = ?', users[0].id);
        if (firstUserPref) {
            // console.log(chalk.dim("[MovieDB] Movie preferences seem to be already seeded. Skipping."));
            return;
        }
    }
    
    console.log(chalk.magenta("Seeding initial movie preferences for users..."));
    let seededCount = 0;
    for (let i = 0; i < Math.min(users.length, mockUserMoviePreferences.length); i++) {
        const user = users[i]!;
        const prefsToSeed: UserMoviePreferences = {
            user_id: user.id,
            ...mockUserMoviePreferences[i], // Spread the mock preference object
        };
        // Fill in any potentially missing optional fields with undefined or null as per your DB schema
        // (Our mock data already aligns with the UserMoviePreferences structure with optional fields)
        await saveUserMoviePreferences(prefsToSeed);
        seededCount++;
    }
    if (seededCount > 0) {
         console.log(chalk.magenta(`${seededCount} users had default movie preferences seeded.`));
    }
}

// --- User Movie Ratings ---
export async function saveUserMovieRating(userId: number, movieId: number, rating: number): Promise<void> {
    const db = await getDB();
    try {
        await db.run(
            `INSERT INTO user_movie_ratings (user_id, movie_id, rating) VALUES (?, ?, ?)
             ON CONFLICT(user_id, movie_id) DO UPDATE SET rating = excluded.rating, rated_at = CURRENT_TIMESTAMP`,
            userId,
            movieId, // This is our internal DB movie ID
            rating
        );
        // console.log(chalk.dim(`[DB] Saved rating ${rating} for user ${userId}, movie ID ${movieId}`));
    } catch (error) {
        console.error(chalk.red(`[DB Error] Error saving rating for user ${userId}, movie ID ${movieId}:`), error);
    }
}

// Returns user ratings along with the TMDB ID of the rated movie for convenience
export async function getUserMovieRatings(userId: number): Promise<(UserMovieRating & {movie_tmdb_id: number})[]> {
    const db = await getDB();
    // Ensure the JOIN is correct and you select m.tmdb_id
    return db.all<(UserMovieRating & {movie_tmdb_id: number})[]>(
        `SELECT umr.user_id, umr.movie_id, umr.rating, m.tmdb_id as movie_tmdb_id
         FROM user_movie_ratings umr
         JOIN movies m ON m.id = umr.movie_id
         WHERE umr.user_id = ?`, userId
    );
}

// Returns our internal DB IDs of movies rated by the user
export async function getRatedMovieIdsByUser(userId: number): Promise<number[]> {
    const db = await getDB();
    const rows = await db.all<{ movie_id: number }[]>('SELECT movie_id FROM user_movie_ratings WHERE user_id = ?', userId);
    return rows.map(r => r.movie_id);
}

// Helper for content-based filtering: Get genres of movies a user rated highly
// This can be used as an implicit preference if explicit preferences are not set
export async function getGenresFromUserHighlyRatedMovies(userId: number, minRating: number = 4): Promise<string[]> {
    const db = await getDB();
    const rows = await db.all<{ genres: string }[]>(`
        SELECT m.genres
        FROM movies m
        JOIN user_movie_ratings umr ON m.id = umr.movie_id
        WHERE umr.user_id = ? AND umr.rating >= ?
    `, userId, minRating);

    const allGenreNames = new Set<string>();
    rows.forEach(row => {
        try {
            const genresArray: Genre[] = JSON.parse(row.genres || '[]');
            genresArray.forEach(g => allGenreNames.add(g.name));
        } catch (e) {
            console.error(chalk.red(`[DB Error] Failed to parse genres for user ${userId} rated movie: ${row.genres}`), e);
        }
    });
    return Array.from(allGenreNames);
}