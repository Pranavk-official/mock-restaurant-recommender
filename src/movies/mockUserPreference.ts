import type { UserMoviePreferences } from './types';

export const mockUserMoviePreferences: Omit<UserMoviePreferences, 'user_id'>[] = [
  { // Alice (User ID 1)
    preferred_genres: ["Action", "Sci-Fi"],
    preferred_languages: ["en"],
    release_year_min: 2010,
    min_imdb_rating: 7.0,
    preferred_streaming_providers: ["Netflix", "Disney Plus"],
  },
  { // Bob (User ID 2)
    preferred_genres: ["Comedy", "Romance"],
    duration_max_minutes: 120,
    min_imdb_rating: 6.5,
  },
  { // Charlie (User ID 3)
    preferred_genres: ["Horror", "Thriller"],
    preferred_languages: ["en", "ko"], // Korean horror fan
    release_year_max: 2022,
  },
  { // Diana (User ID 4)
    preferred_genres: ["Drama", "History", "Documentary"],
    min_imdb_rating: 7.5,
    duration_min_minutes: 90,
  },
  { // Edward (User ID 5)
    preferred_genres: ["Animation", "Family", "Adventure"],
    preferred_streaming_providers: ["Disney Plus", "HBO Max"],
  },
  { // Fiona (User ID 6)
    preferred_genres: ["Mystery", "Crime"],
    release_year_min: 2000,
    release_year_max: 2020,
    min_imdb_rating: 6.8,
  },
];