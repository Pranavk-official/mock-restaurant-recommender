import type { UserTvShowPreferences } from './types';

export const mockUserTvShowPreferences: Omit<UserTvShowPreferences, 'user_id'>[] = [
  { // Alice (User ID 1)
    preferred_genres: ["Sci-Fi", "Drama"],
    preferred_languages: ["en"],
    first_air_year_min: 2015,
    min_imdb_rating: 7.5,
    preferred_streaming_providers: ["Netflix", "Amazon Prime Video"],
  },
  { // Bob (User ID 2)
    preferred_genres: ["Comedy", "Sitcom"],
    avg_episode_duration_max: 30, // Likes shorter episodes
    min_imdb_rating: 7.0,
  },
  { // Charlie (User ID 3)
    preferred_genres: ["Horror", "Supernatural", "Mystery"],
    preferred_languages: ["en", "ja"], // Japanese horror shows
  },
  { // Diana (User ID 4)
    preferred_genres: ["Documentary", "Crime", "Drama"],
    min_imdb_rating: 8.0,
    avg_episode_duration_min: 40,
  },
  { // Edward (User ID 5)
    preferred_genres: ["Animation", "Action", "Adventure"],
    preferred_streaming_providers: ["Netflix", "Hulu"],
  },
  { // Fiona (User ID 6)
    preferred_genres: ["Fantasy", "Adventure"],
    first_air_year_min: 2010,
    min_imdb_rating: 7.2,
    preferred_streaming_providers: ["HBO Max"],
  },
];