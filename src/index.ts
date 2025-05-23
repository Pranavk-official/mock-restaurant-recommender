// src/index.ts
import { initDB, getDB, seedInitialGenericUsers } from './db/setup';
// Make sure restaurant specific seeding is handled within its module or called appropriately
// import { seedInitialRestaurantData } from './database/restaurantDb'; // Example
import { runMainCLI } from './cli/main';
import chalk from 'chalk';
import { seedInitialRestaurantPreferences } from './db/restaurantDb';
import { seedInitialMoviePreferences } from './db/movieDb';
import { seedInitialTvShowPreferences } from './db/tvShowDb';

async function main() {
  console.log(chalk.bold.cyan("🚀 Starting Advanced Recommender System 🚀"));

  await initDB(); // Initializes all tables
  console.log(chalk.green("Database connection established."));

  await seedInitialGenericUsers();       // 1. Generic users
  await seedInitialRestaurantPreferences(); // 2. Restaurant prefs for users
  await seedInitialMoviePreferences();      // 3. Movie prefs for users
  await seedInitialTvShowPreferences();     // 4. TV Show prefs for users

  // The main CLI will now handle fetching data (like restaurants for a location) on demand.
  
  await runMainCLI();

  const dbInstance = await getDB();
  await dbInstance.close();
  console.log(chalk.bold.cyan("Recommender shut down gracefully."));
}

main().catch(async (err) => {
  console.error(chalk.red.bold("Unhandled error in main application:"), err);
  try {
    const dbInstance = await getDB().catch(() => null);
    if (dbInstance) {
      await dbInstance.close();
      console.log("Database connection closed on error.");
    }
  } catch (closeErr) {
    console.error("Error closing DB on unhandled main error:", closeErr);
  }
  process.exit(1);
});