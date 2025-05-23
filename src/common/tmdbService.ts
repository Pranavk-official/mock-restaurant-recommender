// src/common/tmdbService.ts
import chalk from 'chalk';
import type { Genre, WatchProviders, CastMember, Review, WatchProviderDetail } from './types';

// In your .env file, you should have:
// TMDB_API_READ_ACCESS_TOKEN="your_long_v4_read_access_token_here"
// TMDB_API_KEY="your_shorter_v3_api_key_here" (optional, for fallback)

const TMDB_API_READ_ACCESS_TOKEN = process.env.TMDB_API_READ_ACCESS_TOKEN;
const TMDB_API_KEY_V3 = process.env.TMDB_API_KEY; // For fallback if Read Access Token is missing

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/';

// --- Helper Types ---
interface TMDBPaginatedResponse<T> {
    page: number;
    results: T[];
    total_pages: number;
    total_results: number;
}

// --- Core Fetch Function ---
async function fetchTMDB<T>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {}, // Query parameters other than auth
    method: 'GET' | 'POST' = 'GET',
    body?: any
): Promise<T | null> {
    if (!TMDB_API_READ_ACCESS_TOKEN && !TMDB_API_KEY_V3) {
        console.error(chalk.red.bold("Neither TMDB_API_READ_ACCESS_TOKEN nor TMDB_API_KEY (v3) found in .env file. Please set at least one."));
        return null;
    }

    let url = `${TMDB_BASE_URL}/${endpoint}`;
    const fetchOptions: RequestInit = {
        method,
        headers: {
            accept: 'application/json', // TMDB requires this header
            // 'Content-Type': 'application/json', // Only needed for POST/PUT with body
        },
    };

    // Construct query parameters from the 'params' object
    if (Object.keys(params).length > 0) {
        const queryParams = new URLSearchParams(
            Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
        ).toString();
        url += `?${queryParams}`;
    }

    // Prioritize Bearer Token (API Read Access Token)
    if (TMDB_API_READ_ACCESS_TOKEN) {
        (fetchOptions.headers as Record<string, string>)['Authorization'] = `Bearer ${TMDB_API_READ_ACCESS_TOKEN}`;
    }
    // Fallback to API Key in URL if Read Access Token is not provided (and API_KEY_V3 is)
    // This is less common now but was the original v3 method.
    else if (TMDB_API_KEY_V3) {
        const existingParams = new URLSearchParams(url.split('?')[1] || '');
        existingParams.set('api_key', TMDB_API_KEY_V3);
        url = `${url.split('?')[0]}?${existingParams.toString()}`;
        console.warn(chalk.yellow("[TMDB Service] Using fallback TMDB_API_KEY in URL. Preferred method is TMDB_API_READ_ACCESS_TOKEN in Authorization header."));
    }


    if (method === 'POST' && body) {
        fetchOptions.body = JSON.stringify(body);
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
    
    // console.log(chalk.dim(`[TMDB Fetch] ${method} ${url}`)); // For debugging, careful with tokens
    // console.log(chalk.dim(`[TMDB Fetch Options] Headers: ${JSON.stringify(fetchOptions.headers)}`));


    try {
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const errorData: any = await response.json().catch(() => ({
                message: "Failed to parse error JSON from TMDB API response.",
                status_code: response.status
            }));
            const authMethodUsed = TMDB_API_READ_ACCESS_TOKEN ? "API Read Access Token (Bearer)" : "API Key v3 (URL Param)";
            console.error(
                chalk.red(`[TMDB API Error] ${response.status} for ${endpoint} (using ${authMethodUsed}):`),
                errorData.status_message || errorData.message || response.statusText
            );
            if (response.status === 401) {
                 console.error(chalk.yellow(`This usually means your ${authMethodUsed.includes("Bearer") ? "TMDB_API_READ_ACCESS_TOKEN" : "TMDB_API_KEY"} is invalid, expired, or not authorized for this resource.`));
                 console.error(chalk.yellow("Please verify your token/key in your .env file and on the TMDB website."));
            }
            return null;
        }
        // Handle cases where TMDB might return 204 No Content for some POST/DELETE actions
        if (response.status === 204) {
            return {} as T; // Or an appropriate success indicator
        }
        return (await response.json()) as T;
    } catch (error) {
        console.error(chalk.red(`[TMDB Network Error] Failed to fetch ${endpoint}:`), error);
        return null;
    }
}


// --- MOVIE Specific TMDB Data Structures & Functions ---
export interface TMDBMovie { /* ... (as defined previously, ensure it's up-to-date) ... */
    id: number;
    title: string;
    overview: string;
    release_date: string | null;
    vote_average: number;
    vote_count: number;
    poster_path: string | null;
    backdrop_path: string | null;
    genre_ids?: number[];
    genres?: Genre[];
    runtime?: number | null;
    original_language?: string | null;
    imdb_id?: string | null;
    tagline?: string | null;
    popularity?: number;
    credits?: { cast: CastMember[] };
    reviews?: TMDBPaginatedResponse<Review>;
    "watch/providers"?: { results: WatchProviders };
    external_ids?: { imdb_id?: string | null; /* ... other ids ... */ };
}

export async function getMovieDetails(movieId: number): Promise<TMDBMovie | null> {
    return fetchTMDB<TMDBMovie>(`movie/${movieId}`, {
        append_to_response: 'credits,reviews,watch/providers,external_ids'
    });
}

export async function getPopularMovies(page: number = 1): Promise<TMDBPaginatedResponse<TMDBMovie> | null> {
    return fetchTMDB<TMDBPaginatedResponse<TMDBMovie>>('movie/popular', { page });
}

export async function searchMovies(query: string, page: number = 1, year?: number): Promise<TMDBPaginatedResponse<TMDBMovie> | null> {
    const params: Record<string, string | number> = { query, page };
    if (year) params.year = year;
    return fetchTMDB<TMDBPaginatedResponse<TMDBMovie>>('search/movie', params);
}

export async function getMovieRecommendations(movieId: number, page: number = 1): Promise<TMDBPaginatedResponse<TMDBMovie> | null> {
    return fetchTMDB<TMDBPaginatedResponse<TMDBMovie>>(`movie/${movieId}/recommendations`, { page });
}

// --- TV SHOW Specific TMDB Data Structures & Functions ---
export interface TMDBTvShow { /* ... (as defined previously, ensure it's up-to-date) ... */
    id: number;
    name: string;
    imdb_id?: string | null;
    overview: string;
    first_air_date: string | null;
    vote_average: number;
    vote_count: number;
    poster_path: string | null;
    backdrop_path: string | null;
    genre_ids?: number[];
    genres?: Genre[];
    number_of_seasons?: number | null;
    number_of_episodes?: number | null;
    episode_run_time?: number[] | null;
    original_language?: string | null;
    tagline?: string | null;
    popularity?: number;
    status?: string;
    seasons?: TMDBSeasonSummary[];
    credits?: { cast: CastMember[] };
    reviews?: TMDBPaginatedResponse<Review>;
    "watch/providers"?: { results: WatchProviders };
    external_ids?: { imdb_id?: string | null; tvdb_id?: number | null; /* ... */ };
}
export interface TMDBSeasonSummary { /* ... (as defined previously) ... */
    air_date: string | null;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    poster_path: string | null;
    season_number: number;
}
export interface TMDBFullSeason extends TMDBSeasonSummary { /* ... (as defined previously) ... */
    _id?: string;
    episodes?: TMDBEpisodeSummary[];
}
export interface TMDBEpisodeSummary { /* ... (as defined previously) ... */
    air_date: string | null;
    episode_number: number;
    id: number;
    name: string;
    overview: string;
    production_code?: string | null;
    runtime?: number | null;
    season_number: number;
    show_id?: number;
    still_path: string | null;
    vote_average: number;
    vote_count: number;
}

export async function getTvShowDetails(tvId: number): Promise<TMDBTvShow | null> {
    return fetchTMDB<TMDBTvShow>(`tv/${tvId}`, {
        append_to_response: 'credits,reviews,watch/providers,external_ids'
    });
}

export async function getTvShowSeasonDetails(tvId: number, seasonNumber: number): Promise<TMDBFullSeason | null> {
    return fetchTMDB<TMDBFullSeason>(`tv/${tvId}/season/${seasonNumber}`);
}

export async function getPopularTvShows(page: number = 1): Promise<TMDBPaginatedResponse<TMDBTvShow> | null> {
     return fetchTMDB<TMDBPaginatedResponse<TMDBTvShow>>('tv/popular', { page });
}
export async function searchTvShows(query: string, page: number = 1, first_air_date_year?: number): Promise<TMDBPaginatedResponse<TMDBTvShow> | null> {
    const params: Record<string, string | number> = { query, page };
    if (first_air_date_year) params.first_air_date_year = first_air_date_year;
    return fetchTMDB<TMDBPaginatedResponse<TMDBTvShow>>('search/tv', params);
}
export async function getTvShowRecommendations(tvId: number, page: number = 1): Promise<TMDBPaginatedResponse<TMDBTvShow> | null> {
    return fetchTMDB<TMDBPaginatedResponse<TMDBTvShow>>(`tv/${tvId}/recommendations`, { page });
}

// --- GENRE LISTS (Cached) ---
// ... (getMovieGenreList, getTvShowGenreList, mapMovieGenreIdsToObjects, mapTvGenreIdsToObjects as before) ...
let movieGenreListCache: Genre[] | null = null;
export async function getMovieGenreList(): Promise<Genre[]> {
    if (movieGenreListCache) return movieGenreListCache;
    const response = await fetchTMDB<{ genres: Genre[] }>(`genre/movie/list`);
    if (response && response.genres) {
        movieGenreListCache = response.genres;
        console.log(chalk.dim("[TMDB Service] Movie genres cached."));
        return response.genres;
    }
    return [];
}

let tvGenreListCache: Genre[] | null = null;
export async function getTvShowGenreList(): Promise<Genre[]> {
    if (tvGenreListCache) return tvGenreListCache;
    const response = await fetchTMDB<{ genres: Genre[] }>(`genre/tv/list`);
    if (response && response.genres) {
        tvGenreListCache = response.genres;
        console.log(chalk.dim("[TMDB Service] TV show genres cached."));
        return response.genres;
    }
    return [];
}

export async function mapMovieGenreIdsToObjects(genre_ids?: number[]): Promise<Genre[]> {
    if (!genre_ids || genre_ids.length === 0) return [];
    const fullGenreList = await getMovieGenreList();
    return genre_ids
        .map(id => fullGenreList.find(g => g.id === id))
        .filter(g => g !== undefined) as Genre[];
}

export async function mapTvGenreIdsToObjects(genre_ids?: number[]): Promise<Genre[]> {
    if (!genre_ids || genre_ids.length === 0) return [];
    const fullGenreList = await getTvShowGenreList();
    return genre_ids
        .map(id => fullGenreList.find(g => g.id === id))
        .filter(g => g !== undefined) as Genre[];
}

// --- WATCH PROVIDER LISTS ---
// ... (getMovieWatchProviders, getTvWatchProviders as before) ...
export async function getMovieWatchProviders(): Promise<{results: WatchProviderDetail[]} | null> {
    return fetchTMDB<{results: WatchProviderDetail[]}>(`watch/providers/movie`);
}
export async function getTvWatchProviders(): Promise<{results: WatchProviderDetail[]} | null> {
    return fetchTMDB<{results: WatchProviderDetail[]}>(`watch/providers/tv`);
}

// --- UTILITY ---
// ... (getPosterUrl, getStillUrl as before) ...
export function getPosterUrl(
    path: string | null,
    size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w342'
): string | null {
    return path ? `${TMDB_IMAGE_BASE_URL}${size}${path}` : null;
}

export function getStillUrl( 
    path: string | null,
    size: 'w92' | 'w185' | 'w300' | 'original' = 'w300'
): string | null {
    return path ? `${TMDB_IMAGE_BASE_URL}${size}${path}` : null;
}