import { getDB } from './setup'; 
import type { Restaurant, RestaurantUserPreferences, UserRestaurantLike } from '../restaurants/types';
// import { mockUserRestaurantPreferences } from '../restaurants/data/mockUserRestaurantPreferences'; // Path to mock preferences
import { fetchRestaurantsFromGooglePlaces } from '../restaurants/googleApiService'; // Path to google service
import type { User } from '../common/types'; // Common User type
import chalk from 'chalk';
import { mockUsers } from '../data/mockUsers';

// --- Restaurant Data ---
export async function saveRestaurantToDb(
    restaurantData: Omit<Restaurant, 'id'>
): Promise<Restaurant | undefined> {
    const db = await getDB();
    try {
        const existing = await db.get<Restaurant>(
            'SELECT * FROM restaurants WHERE googlePlaceId = ?',
            restaurantData.googlePlaceId
        );
        if (existing) return existing;

        const result = await db.run(
            `INSERT INTO restaurants (googlePlaceId, name, address, cuisines, dietaryOptions, rating)
             VALUES (?, ?, ?, ?, ?, ?)`,
            restaurantData.googlePlaceId,
            restaurantData.name,
            restaurantData.address,
            JSON.stringify(restaurantData.cuisines),
            JSON.stringify(restaurantData.dietaryOptions),
            restaurantData.rating
        );
        if (result.lastID) {
            return getRestaurantById(result.lastID);
        }
    } catch (error: any) {
        if (error.message?.includes('UNIQUE constraint failed')) {
            return db.get<Restaurant>('SELECT * FROM restaurants WHERE googlePlaceId = ?', restaurantData.googlePlaceId);
        }
        console.error(chalk.red(`Error saving restaurant "${restaurantData.name}":`), error);
    }
    return undefined;
}

export async function getRestaurantById(id: number): Promise<Restaurant | undefined> {
    const db = await getDB();
    const row = await db.get<any>('SELECT * FROM restaurants WHERE id = ?', id);
    if (!row) return undefined;
    return {
        ...row,
        cuisines: JSON.parse(row.cuisines || '[]'),
        dietaryOptions: JSON.parse(row.dietaryOptions || '[]'),
    };
}

export async function getAllRestaurantsFromDb(): Promise<Restaurant[]> {
    const db = await getDB();
    const rows = await db.all<any[]>('SELECT * FROM restaurants');
    return rows.map(row => ({
        ...row,
        cuisines: JSON.parse(row.cuisines || '[]'),
        dietaryOptions: JSON.parse(row.dietaryOptions || '[]'),
    }));
}

export async function fetchAndSaveRestaurantsToDb(locationQuery: string): Promise<void> {
    if (!locationQuery || locationQuery.trim() === "") {
        console.log(chalk.yellow("Location query is empty. Skipping Google Places API fetch."));
        return;
    }
    const restaurantsFromApi = await fetchRestaurantsFromGooglePlaces(locationQuery);
    if (!restaurantsFromApi || restaurantsFromApi.length === 0) {
        console.log(chalk.yellow("No restaurants from Google API. DB not updated."));
        return;
    }
    let savedCount = 0;
    let skippedCount = 0;
    for (const resto of restaurantsFromApi) {
        const saved = await saveRestaurantToDb(resto);
        if (saved && !await isRestaurantPreviouslySaved(resto.googlePlaceId, saved.id)) { // Check if it's truly new vs just fetched again
             savedCount++;
        } else {
             skippedCount++;
        }
    }
    console.log(chalk.green(`Saved ${savedCount} new restaurants. Skipped ${skippedCount} (likely existing).`));
}
// Helper to avoid double counting if saveRestaurantToDb returns existing
async function isRestaurantPreviouslySaved(googlePlaceId: string, currentIdInDb: number): Promise<boolean> {
    const db = await getDB();
    const count = await db.get<{c: number}>('SELECT COUNT(*) as c FROM restaurants WHERE googlePlaceId = ? AND id != ?', googlePlaceId, currentIdInDb);
    return (count?.c ?? 0) > 0;
}


// --- User Restaurant Preferences ---
export async function saveUserRestaurantPreferences(
    prefs: RestaurantUserPreferences
): Promise<void> {
    const db = await getDB();
    try {
        await db.run(
            `INSERT INTO user_restaurant_preferences (user_id, favoriteCuisines, dietaryRestrictions, minRating)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               favoriteCuisines = excluded.favoriteCuisines,
               dietaryRestrictions = excluded.dietaryRestrictions,
               minRating = excluded.minRating`,
            prefs.user_id,
            JSON.stringify(prefs.favoriteCuisines),
            JSON.stringify(prefs.dietaryRestrictions),
            prefs.minRating
        );
    } catch (error) {
        console.error(chalk.red(`Error saving restaurant prefs for user ${prefs.user_id}:`), error);
    }
}

export async function getUserRestaurantPreferences(userId: number): Promise<RestaurantUserPreferences | undefined> {
    const db = await getDB();
    const row = await db.get<any>(
        'SELECT * FROM user_restaurant_preferences WHERE user_id = ?',
        userId
    );
    if (!row) return undefined;
    return {
        user_id: row.user_id,
        favoriteCuisines: JSON.parse(row.favoriteCuisines || '[]'),
        dietaryRestrictions: JSON.parse(row.dietaryRestrictions || '[]'),
        minRating: row.minRating,
    };
}

// Seed initial restaurant preferences for existing generic users
export async function seedInitialRestaurantPreferences(): Promise<void> {
    const db = await getDB();
    const users = await db.all<User[]>('SELECT id FROM users ORDER BY id ASC'); // Get users in order

    if (users.length > 0) {
        const prefCount = await db.get('SELECT COUNT(*) as count FROM user_restaurant_preferences');
        if (prefCount && prefCount.count === 0) {
            console.log("Seeding initial restaurant preferences for users...");
            for (let i = 0; i < Math.min(users.length, mockUsers.length); i++) {
                const currentUser = users[i];
                const mockUserData = mockUsers[i];

                if (currentUser && currentUser.id != null && mockUserData && mockUserData.preferences) {
                    await saveUserRestaurantPreferences({
                        user_id: currentUser.id,
                        ...mockUserData.preferences,
                    });
                } else {
                    console.warn(chalk.yellow(`Skipping seeding preferences for user index ${i}: User ID or mock preferences data is missing.`));
                }
            }
            console.log("Restaurant preferences seeded.");
        }
    }
}


// --- User Restaurant Likes ---
export async function recordUserRestaurantLike(userId: number, restaurantId: number): Promise<void> {
    const db = await getDB();
    try {
        await db.run(
            'INSERT INTO user_restaurant_likes (user_id, restaurant_id) VALUES (?, ?) ON CONFLICT(user_id, restaurant_id) DO NOTHING',
            userId,
            restaurantId
        );
    } catch (error) {
        console.error(chalk.red(`Error recording like for user ${userId}, restaurant ${restaurantId}:`), error);
    }
}

export async function getLikedRestaurantIdsByUserId(userId: number): Promise<number[]> {
    const db = await getDB();
    try {
        const rows = await db.all<{ restaurant_id: number }[]>(
            'SELECT restaurant_id FROM user_restaurant_likes WHERE user_id = ?',
            userId
        );
        return rows.map(row => row.restaurant_id);
    } catch (error) {
        console.error(chalk.red(`Error fetching liked restaurants for user ${userId}:`), error);
        return [];
    }
}