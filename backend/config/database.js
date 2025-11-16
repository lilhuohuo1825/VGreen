/** 
 * Cấu hình database 
 * Database name: vgreen (cố định) 
 */ 

const DATABASE_NAME = "vgreen";
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGO_URI environment variable is required!");
  process.exit(1);
}

module.exports = {
  DATABASE_NAME,
  MONGODB_URI,
};
