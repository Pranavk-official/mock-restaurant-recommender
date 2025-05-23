import { getDB, type User } from './setup';
import { mockUserTvShowPreferences } from '../tvshows/mockUserPreference';
import type { TvShow, UserTvShowRating, UserTvShowPreferences } from '../tvshows/types';
import type { TMDBTvShow as TMDBTvShowFromService } from '../common/tmdbService';
import { mapTvGenreIdsToObjects } from '../common/tmdbService';
import type { Genre } from '../common/types';
import chalk from 'chalk';

async function ensureFullTvGenreObjects(tvShowData: TMDBTvShowFromService): Promise<Genre[]> {
    if (tvShowData.genres && tvShowData.genres.length > 0) return tvShowData.genres;
    if (tvShowData.genre_ids && tvShowData.genre_ids.length > 0) return mapTvGenreIdsToObjects(tvShowData.genre_ids);
    return [];
}

export async function saveTvShow(tvShowData: TMDBTvShowFromService): Promise<TvShow | undefined> {
    const db = await getDB();
    try {
        const existing = await db.get<TvShow>('SELECT * FROM tv_shows WHERE tmdb_id = ?', tvShowData.id);
        const fullGenres = await ensureFullTvGenreObjects(tvShowData);
        const imdbIdToSave = tvShowData.imdb_id || tvShowData.external_ids?.imdb_id || null;

        if (existing) {
            await db.run(
                `UPDATE tv_shows SET
                    name = ?, overview = ?, first_air_date = ?, vote_average = ?, vote_count = ?,
                    poster_path = ?, backdrop_path = ?, genres = ?, number_of_seasons = ?,
                    episode_run_time = ?, original_language = ?, imdb_id = ?
                 WHERE tmdb_id = ?`,
                tvShowData.name, tvShowData.overview, tvShowData.first_air_date, tvShowData.vote_average, tvShowData.vote_count,
                tvShowData.poster_path, tvShowData.backdrop_path,
                JSON.stringify(fullGenres.map(g => ({id: g.id, name: g.name}))),
                tvShowData.number_of_seasons === undefined ? null : tvShowData.number_of_seasons,
                tvShowData.episode_run_time ? JSON.stringify(tvShowData.episode_run_time) : null,
                tvShowData.original_language === undefined ? null : tvShowData.original_language,
                imdbIdToSave,
                tvShowData.id
            );
            return getTvShowByTmdbId(tvShowData.id);
        }

        const result = await db.run(
            `INSERT INTO tv_shows (tmdb_id, name, overview, first_air_date, vote_average, vote_count,
                                   poster_path, backdrop_path, genres, number_of_seasons, episode_run_time, original_language, imdb_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            tvShowData.id, tvShowData.name, tvShowData.overview, tvShowData.first_air_date,
            tvShowData.vote_average, tvShowData.vote_count, tvShowData.poster_path, tvShowData.backdrop_path,
            JSON.stringify(fullGenres.map(g => ({id: g.id, name: g.name}))),
            tvShowData.number_of_seasons === undefined ? null : tvShowData.number_of_seasons,
            tvShowData.episode_run_time ? JSON.stringify(tvShowData.episode_run_time) : null,
            tvShowData.original_language === undefined ? null : tvShowData.original_language,
            imdbIdToSave
        );
        if (result.lastID) {
            return getTvShowByOurId(result.lastID);
        }
    } catch (error: any) {
        if (error.message?.includes('UNIQUE constraint failed: tv_shows.tmdb_id')) {
            return db.get<TvShow>('SELECT * FROM tv_shows WHERE tmdb_id = ?', tvShowData.id).then(mapDbRowToTvShow);
        }
        console.error(chalk.red(`Error saving TV show TMDB ID ${tvShowData.id} ("${tvShowData.name}"):`), error);
    }
    return undefined;
}

const mapDbRowToTvShow = (row: any): TvShow | undefined => {
    if (!row) return undefined;
    return {
        id: row.id,
        tmdb_id: row.tmdb_id,
        name: row.name,
        overview: row.overview,
        first_air_date: row.first_air_date,
        vote_average: row.vote_average,
        vote_count: row.vote_count,
        poster_path: row.poster_path,
        backdrop_path: row.backdrop_path,
        genres: JSON.parse(row.genres || '[]') as Genre[],
        number_of_seasons: row.number_of_seasons,
        episode_run_time: row.episode_run_time ? JSON.parse(row.episode_run_time) : null,
        original_language: row.original_language,
        imdb_id: row.imdb_id,
    };
};

export async function getTvShowByOurId(id: number): Promise<TvShow | undefined> {
    const db = await getDB();
    const row = await db.get<any>('SELECT * FROM tv_shows WHERE id = ?', id);
    return mapDbRowToTvShow(row);
}

export async function getTvShowByTmdbId(tmdbId: number): Promise<TvShow | undefined> {
    const db = await getDB();
    const row = await db.get<any>('SELECT * FROM tv_shows WHERE tmdb_id = ?', tmdbId);
    return mapDbRowToTvShow(row);
}

// --- Seed Initial TV Show Preferences for Generic Users ---
export async function seedInitialTvShowPreferences(): Promise<void> {
    const db = await getDB();
    const users = await db.all<User[]>('SELECT id, name FROM users ORDER BY id ASC');

    if (users.length === 0) {
        // console.log(chalk.yellow("[TvShowDB] No users found to seed TV show preferences for."));
        return;
    }

    // At this point, users array is guaranteed to be non-empty.
    const firstUser = users[0]!;
    const firstUserPref = await db.get('SELECT 1 FROM user_tv_show_preferences WHERE user_id = ?', firstUser.id);
    if (firstUserPref) {
        // console.log(chalk.dim("[TvShowDB] TV show preferences seem to be already seeded. Skipping."));
        return;
    }

    console.log(chalk.magenta("Seeding initial TV show preferences for users..."));
    let seededCount = 0;
    for (let i = 0; i < Math.min(users.length, mockUserTvShowPreferences.length); i++) {
        const user = users[i]!;
        const prefsToSeed: UserTvShowPreferences = {
            user_id: user.id,
            ...mockUserTvShowPreferences[i],
        };
        await saveUserTvShowPreferences(prefsToSeed);
        seededCount++;
    }
     if (seededCount > 0) {
        console.log(chalk.magenta(`${seededCount} users had default TV show preferences seeded.`));
    }
}


// --- User TV Show Preferences ---
export async function saveUserTvShowPreferences(prefs: UserTvShowPreferences): Promise<void> {
    const db = await getDB();
    try {
        await db.run(
            `INSERT INTO user_tv_show_preferences (
                user_id, preferred_genres, preferred_languages, first_air_year_min, first_air_year_max,
                avg_episode_duration_min, avg_episode_duration_max, min_imdb_rating, preferred_streaming_providers
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                preferred_genres = excluded.preferred_genres,
                preferred_languages = excluded.preferred_languages,
                first_air_year_min = excluded.first_air_year_min,
                first_air_year_max = excluded.first_air_year_max,
                avg_episode_duration_min = excluded.avg_episode_duration_min,
                avg_episode_duration_max = excluded.avg_episode_duration_max,
                min_imdb_rating = excluded.min_imdb_rating,
                preferred_streaming_providers = excluded.preferred_streaming_providers
            `,
            prefs.user_id,
            prefs.preferred_genres ? JSON.stringify(prefs.preferred_genres) : null,
            prefs.preferred_languages ? JSON.stringify(prefs.preferred_languages) : null,
            prefs.first_air_year_min === undefined ? null : prefs.first_air_year_min,
            prefs.first_air_year_max === undefined ? null : prefs.first_air_year_max,
            prefs.avg_episode_duration_min === undefined ? null : prefs.avg_episode_duration_min,
            prefs.avg_episode_duration_max === undefined ? null : prefs.avg_episode_duration_max,
            prefs.min_imdb_rating === undefined ? null : prefs.min_imdb_rating,
            prefs.preferred_streaming_providers ? JSON.stringify(prefs.preferred_streaming_providers) : null
        );
    } catch (error) {
        console.error(chalk.red(`Error saving TV show preferences for user ${prefs.user_id}:`), error);
    }
}

export async function getUserTvShowPreferences(userId: number): Promise<UserTvShowPreferences | undefined> {
    const db = await getDB();
    const row = await db.get<any>(
        'SELECT * FROM user_tv_show_preferences WHERE user_id = ?',
        userId
    );
    if (!row) return undefined;
    return {
        user_id: row.user_id,
        preferred_genres: row.preferred_genres ? JSON.parse(row.preferred_genres) : undefined,
        preferred_languages: row.preferred_languages ? JSON.parse(row.preferred_languages) : undefined,
        first_air_year_min: row.first_air_year_min === null ? undefined : row.first_air_year_min,
        first_air_year_max: row.first_air_year_max === null ? undefined : row.first_air_year_max,
        avg_episode_duration_min: row.avg_episode_duration_min === null ? undefined : row.avg_episode_duration_min,
        avg_episode_duration_max: row.avg_episode_duration_max === null ? undefined : row.avg_episode_duration_max,
        min_imdb_rating: row.min_imdb_rating === null ? undefined : row.min_imdb_rating,
        preferred_streaming_providers: row.preferred_streaming_providers ? JSON.parse(row.preferred_streaming_providers) : undefined,
    };
}

// --- User TV Show Ratings ---
export async function saveUserTvShowRating(userId: number, tvShowId: number, rating: number): Promise<void> {
    const db = await getDB();
    try {
        await db.run(
            `INSERT INTO user_tv_show_ratings (user_id, tv_show_id, rating) VALUES (?, ?, ?)
             ON CONFLICT(user_id, tv_show_id) DO UPDATE SET rating = excluded.rating, rated_at = CURRENT_TIMESTAMP`,
            userId,
            tvShowId,
            rating
        );
    } catch (error) {
        console.error(chalk.red(`Error saving TV show rating for user ${userId}, TV show ${tvShowId}:`), error);
    }
}

export async function getUserTvShowRatings(userId: number): Promise<(UserTvShowRating & {tv_show_tmdb_id: number})[]> {
    const db = await getDB();
    return db.all<(UserTvShowRating & {tv_show_tmdb_id: number})[]>(
        `SELECT utr.user_id, utr.tv_show_id, utr.rating, ts.tmdb_id as tv_show_tmdb_id
         FROM user_tv_show_ratings utr
         JOIN tv_shows ts ON ts.id = utr.tv_show_id
         WHERE utr.user_id = ?`, userId
    );
}

export async function getRatedTvShowIdsByUser(userId: number): Promise<number[]> { // Returns OUR DB IDs
    const db = await getDB();
    const rows = await db.all<{ tv_show_id: number }[]>('SELECT tv_show_id FROM user_tv_show_ratings WHERE user_id = ?', userId);
    return rows.map(r => r.tv_show_id);
}