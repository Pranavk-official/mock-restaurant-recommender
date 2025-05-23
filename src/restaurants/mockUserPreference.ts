import type { RestaurantUserPreferences } from './types';

export const mockUserRestaurantPreferences: Omit<RestaurantUserPreferences, 'user_id'>[] = [
  { // For User Alice (ID 1)
    favoriteCuisines: ["Italian", "Mexican"],
    dietaryRestrictions: [],
    minRating: 4.0,
  },
  { // For User Bob (ID 2)
    favoriteCuisines: ["Indian", "Thai", "Vietnamese"],
    dietaryRestrictions: ["vegetarian"],
    minRating: 4.2,
  },
  { // For User Charlie (ID 3)
    favoriteCuisines: ["American", "BBQ"],
    dietaryRestrictions: [],
    minRating: 3.5,
  },
  { // For User Diana (ID 4)
    favoriteCuisines: ["Japanese", "Sushi", "Ramen"],
    dietaryRestrictions: ["gluten-free"],
    minRating: 4.5,
  },
  { // For User Edward (ID 5)
    favoriteCuisines: ["Mediterranean", "Greek", "Cafe"],
    dietaryRestrictions: ["vegan"],
    minRating: 3.8,
  },
  { // For User Fiona (ID 6)
    favoriteCuisines: ["Any"], // Special case for "any cuisine"
    dietaryRestrictions: [],
    minRating: 3.0,
  }
];