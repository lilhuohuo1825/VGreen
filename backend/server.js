// Load environment variables (only in development)
if (process.env.NODE_ENV !== 'production') {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const { sendOTPEmail, generateOTP } = require("./email-service");
// Import từ file sync tổng hợp (gộp tất cả collections)
const {
  syncUsersToJsonAsync,
  syncUsersToJson,
  syncProductsToJsonAsync,
  syncProductsToJson,
  syncBlogsToJsonAsync,
  syncBlogsToJson,
  syncAllCollectionsToJsonAsync,
  syncAllCollectionsToJson,
} = require("./services/sync-collections.service");
const {
  connectDB,
  Order,
  generateOrderID,
  Promotion,
  PromotionUsage,
  Product,
  User,
} = require("./db");

const app = express();
// Hosting platforms such as Render provide PORT via environment variable
// Fallback về 3000 cho local development
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = [
  "http://localhost:4200",
  "http://localhost:4201", // Admin local
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [])
];

console.log('🔒 CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin is allowed
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Log rejected origin for debugging
      console.log('⚠️ CORS rejected origin:', origin);
      // Return false instead of error to avoid 500
      callback(null, false);
    }
  },
  credentials: true
}));
// Tăng limit để nhận base64 images (tối đa 50MB cho review với nhiều ảnh)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// MongoDB connection string from environment variable
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("❌ MONGO_URI environment variable is required!");
  process.exit(1);
}

const DB_NAME = "vgreen"; // Changed to lowercase to match MongoDB case-sensitivity

let db;
let mongoClient;
let usersCollection;
let adminsCollection;
let ordersCollection;
let productsCollection;
let promotionsCollection;
let orderDetailsCollection;
let provincesCollection;
let wardsCollection;
let treeCollection;
let blogsCollection;
let promotionTargetsCollection;
let notificationsCollection;
let isMongoConnected = false;

// Middleware để kiểm tra MongoDB connection
const checkMongoConnection = (req, res, next) => {
  if (!isMongoConnected || !db) {
    console.error("❌ MongoDB not connected");
    console.error("   isMongoConnected:", isMongoConnected);
    console.error("   db:", db ? "exists" : "null");
    return res.status(503).json({
      error: "Lỗi kết nối MongoDB!",
      details: "MongoDB connection not established",
      checklist: [
        "Backend đang chạy tại http://localhost:3000",
        "MongoDB đang chạy",
        'Database "vgreen" tồn tại',
        'Collection "users" có dữ liệu',
      ],
    });
  }

  // Check if required collections exist
  if (!usersCollection || !adminsCollection) {
    console.error("❌ Collections not initialized");
    console.error("   usersCollection:", usersCollection ? "exists" : "null");
    console.error("   adminsCollection:", adminsCollection ? "exists" : "null");
    return res.status(503).json({
      error: "Database chưa sẵn sàng. Vui lòng thử lại sau.",
      details: "Collections not initialized",
    });
  }

  next();
};

// Connect to MongoDB
// First connect Mongoose (for Order, Promotion models)
// console.log("\n🔗 Attempting to connect to MongoDB...");
// console.log("🔗 Step 1: Connecting Mongoose...");
connectDB()
  .then(() => {
    // console.log("✅ Mongoose connected successfully!");

    // Then connect native MongoDB client
    // console.log("🔗 Step 2: Connecting MongoDB Native Client...");
    // console.log(`   URI: ${MONGODB_URI}`);
    // console.log(`   Database: ${DB_NAME}\n`);

    return MongoClient.connect(MONGODB_URI);
  })
  .then((client) => {
    // console.log("✅ Connected to MongoDB successfully!");
    mongoClient = client;
    db = client.db(DB_NAME);

    // console.log(`✅ Database "${DB_NAME}" accessed`);

    // Get collections
    usersCollection = db.collection("users");
    adminsCollection = db.collection("admins");
    ordersCollection = db.collection("orders");
    productsCollection = db.collection("products");
    promotionsCollection = db.collection("promotions");
    orderDetailsCollection = db.collection("orderdetails");
    provincesCollection = db.collection("provinces");
    wardsCollection = db.collection("wards");
    treeCollection = db.collection("tree");
    blogsCollection = db.collection("blogs");
    promotionTargetsCollection = db.collection("promotion_target");
    notificationsCollection = db.collection("notifications");

    isMongoConnected = true;

    console.log("Collections initialized:");
    console.log("   - users");
    console.log("   - admins");
    console.log("   - orders");
    console.log("   - products");
    console.log("   - promotions");
    console.log("   - orderdetails");
    console.log("   - provinces");
    console.log("   - wards");
    console.log("   - tree");
    console.log("   - blogs");
    console.log("   - promotion_targets");
    console.log("   - notifications");

    // Verify collections have data
    Promise.all([
      usersCollection.countDocuments(),
      adminsCollection.countDocuments(),
      ordersCollection.countDocuments(),
    ])
      .then((counts) => {
        console.log("\nCollection document counts:");
        console.log(`   - users: ${counts[0]} documents`);
        console.log(`   - admins: ${counts[1]} documents`);
        console.log(`   - orders: ${counts[2]} documents`);

        if (counts[0] === 0) {
          console.log("!!! WARNING: users collection is empty!");
          console.log("   Run: cd backend && ./import-data.sh");
        } else {
          // Tự động đồng bộ tất cả collections khi server khởi động
          // console.log(
          //   "\nĐang đồng bộ tất cả collections từ MongoDB về JSON..."
          // );
          syncAllCollectionsToJsonAsync(db, {
            usersCollection: usersCollection,
            productsCollection: productsCollection,
            blogsCollection: blogsCollection,
          });
        }
      })
      .catch((err) => {
        console.log("⚠️  Could not count documents:", err.message);
      });

    // console.log("\n✅ MongoDB ready for API requests!\n");

    // ========== SCHEDULED JOBS: Tự động chuyển order status ==========
    // Helper function để chuyển received → completed
    const processReceivedToCompleted = async () => {
      try {
        // Import Order model
        const { Order } = require("./db");
        const now = new Date();
        const twentyFourHoursAgo = new Date(
          now.getTime() - 24 * 60 * 60 * 1000
        ); // Production: 24 giờ

        const receivedOrders = await Order.find({ status: "received" });

        if (receivedOrders.length === 0) {
          return; // Không có đơn hàng received nào
        }

        // console.log(
        //   `\n⏰ [Scheduled Job] Checking ${receivedOrders.length} received orders for auto-completion...`
        // );
        // console.log(`   Current time: ${now.toLocaleString("vi-VN")}`);
        // console.log(
        //   `   One minute ago: ${oneMinuteAgo.toLocaleString("vi-VN")}`
        // );

        const ordersToComplete = receivedOrders.filter((order) => {
          let routes = order.routes || {};
          if (routes instanceof Map) {
            routes = Object.fromEntries(routes);
          }

          const receivedDate = routes.received || routes["received"];
          let shouldComplete = false;
          let timeDiff = 0;

          if (!receivedDate) {
            // Nếu không có received date trong routes, fallback to updatedAt
            const updatedAt = order.updatedAt || order.UpdatedAt;
            if (updatedAt) {
              const updatedAtDate =
                updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
              timeDiff = now.getTime() - updatedAtDate.getTime();
              shouldComplete = updatedAtDate <= twentyFourHoursAgo;
              if (shouldComplete) {
                // console.log(
                //   `   📋 Order ${
                //     order.OrderID
                //   }: No received date, using updatedAt: ${updatedAtDate.toLocaleString(
                //     "vi-VN"
                //   )} (${Math.round(timeDiff / 1000)}s ago)`
                // );
              }
            }
            // else {
            // console.log(
            //   `   ⚠️ Order ${order.OrderID}: No received date and no updatedAt`
            // );
            // }
          } else {
            // Convert to Date if it's a string or object
            const receivedDateObj =
              receivedDate instanceof Date
                ? receivedDate
                : new Date(receivedDate);
            timeDiff = now.getTime() - receivedDateObj.getTime();
            shouldComplete = receivedDateObj <= twentyFourHoursAgo;
            if (shouldComplete) {
              console.log(
                `   📋 Order ${order.OrderID
                }: Received date: ${receivedDateObj.toLocaleString(
                  "vi-VN"
                )} (${Math.round(timeDiff / 1000)}s ago)`
              );
            }
            // else {
            // console.log(
            //   `   ℹ️ Order ${
            //     order.OrderID
            //   }: Received date: ${receivedDateObj.toLocaleString(
            //     "vi-VN"
            //   )} (${Math.round(timeDiff / 1000)}s ago - not old enough)`
            // );
            // }
          }

          return shouldComplete;
        });

        if (ordersToComplete.length > 0) {
          // console.log(
          //   `   ✅ Found ${ordersToComplete.length} received orders older than 1 minute, auto-completing...`
          // );
          for (const order of ordersToComplete) {
            let routes = order.routes || {};
            if (routes instanceof Map) {
              routes = Object.fromEntries(routes);
            }
            if (!routes.completed && !routes["completed"]) {
              routes.completed = new Date();
              if (!routes.received && !routes["received"]) {
                const updatedAt = order.updatedAt || order.UpdatedAt;
                routes.received = updatedAt || new Date();
              }
              const result = await Order.findOneAndUpdate(
                { OrderID: order.OrderID },
                { status: "completed", routes: routes, updatedAt: new Date() },
                { new: true, runValidators: true }
              );

              if (result) {
                // console.log(
                //   `   ✅ [Scheduled Job] Auto-completed order ${order.OrderID}: received → completed`
                // );

                // Tăng purchase_count cho tất cả sản phẩm trong order (1 lượt per order, not per quantity)
                try {
                  const { Product } = require("./db");
                  // Group items by SKU to ensure each product only gets +1 per order
                  const uniqueSKUs = new Set();
                  for (const item of result.items || order.items || []) {
                    if (item.sku && !uniqueSKUs.has(item.sku)) {
                      uniqueSKUs.add(item.sku);
                      await Product.findOneAndUpdate(
                        { sku: item.sku },
                        { $inc: { purchase_count: 1 } },
                        { new: true }
                      );
                    }
                  }
                } catch (productError) {
                  console.error(
                    "   ❌ [Scheduled Job] Error updating product purchase_count:",
                    productError
                  );
                }
              }
              // else {
              // console.log(
              //   `   ⚠️ [Scheduled Job] Failed to update order ${order.OrderID} - order not found`
              // );
              // }
            }
            // else {
            //   console.log(
            //     `   ⚠️ [Scheduled Job] Order ${order.OrderID} already has completed timestamp, skipping`
            //   );
            // }
          }
        }
        // else {
        //   console.log(`   ℹ️ No received orders older than 1 minute found`);
        // }
      } catch (error) {
        console.error(
          "❌ [Scheduled Job] Error auto-completing received orders:",
          error
        );
        console.error("   Error details:", error.message);
        if (error.stack) {
          console.error("   Stack:", error.stack);
        }
      }
    };

    // Chạy ngay lập tức khi server start để xử lý các đơn hàng cũ
    console.log("🚀 Running initial check for received → completed orders...");
    processReceivedToCompleted();

    // Scheduled job: Tự động chuyển received → completed mỗi 30 giây
    setInterval(processReceivedToCompleted, 30 * 1000);

    // Helper function để chuyển delivered → received
    const processDeliveredToReceived = async () => {
      try {
        const { Order } = require("./db");
        const now = new Date();
        const twentyFourHoursAgo = new Date(
          now.getTime() - 24 * 60 * 60 * 1000
        ); // Production: 24 giờ

        const deliveredOrders = await Order.find({ status: "delivered" });
        const ordersToReceive = deliveredOrders.filter((order) => {
          let routes = order.routes || {};
          if (routes instanceof Map) {
            routes = Object.fromEntries(routes);
          }
          const deliveredDate = routes.delivered || routes["delivered"];
          if (!deliveredDate) {
            const updatedAt = order.updatedAt || order.UpdatedAt;
            if (updatedAt) {
              const updatedAtDate =
                updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
              return updatedAtDate <= twentyFourHoursAgo;
            }
            return false;
          }
          const deliveredDateObj =
            deliveredDate instanceof Date
              ? deliveredDate
              : new Date(deliveredDate);
          return deliveredDateObj <= twentyFourHoursAgo;
        });

        if (ordersToReceive.length > 0) {
          console.log(
            `\n⏰ [Scheduled Job] Checking ${ordersToReceive.length} delivered orders for auto-receiving...`
          );
          for (const order of ordersToReceive) {
            let routes = order.routes || {};
            if (routes instanceof Map) {
              routes = Object.fromEntries(routes);
            }
            if (!routes.received && !routes["received"]) {
              routes.received = new Date();
              if (!routes.delivered && !routes["delivered"]) {
                const updatedAt = order.updatedAt || order.UpdatedAt;
                routes.delivered = updatedAt || new Date();
              }
              await Order.findOneAndUpdate(
                { OrderID: order.OrderID },
                { status: "received", routes: routes, updatedAt: new Date() },
                { new: true, runValidators: true }
              );
              console.log(
                `✅ [Scheduled Job] Auto-received order ${order.OrderID}: delivered → received`
              );
            }
          }
        }
      } catch (error) {
        console.error(
          "❌ [Scheduled Job] Error auto-receiving delivered orders:",
          error
        );
      }
    };

    // Chạy ngay lập tức khi server start để xử lý các đơn hàng cũ
    console.log("🚀 Running initial check for delivered → received orders...");
    processDeliveredToReceived();

    // Scheduled job: Tự động chuyển delivered → received mỗi 30 giây
    setInterval(processDeliveredToReceived, 30 * 1000);

    console.log(
      "✅ Scheduled jobs started: Auto-transition orders every 30 seconds"
    );
  })
  .catch((error) => {
    console.error("\n❌ MongoDB connection failed!");
    console.error("   Error:", error.message);
    console.error("\n📝 Troubleshooting checklist:");
    console.error("   1. Is MongoDB running?");
    console.error("      → Check: brew services list | grep mongodb");
    console.error("      → Start: brew services start mongodb-community");
    console.error("   2. Is MONGO_URI environment variable set correctly?");
    console.error('      → Test: mongosh --eval "db.version()"');
    console.error('   3. Does database "vgreen" exist?');
    console.error("      → Check in MongoDB Compass");
    console.error("   4. Do collections have data?");
    console.error("      → Import data: cd backend && ./import-data.sh\n");

    isMongoConnected = false;
    // Không exit process, để server vẫn chạy và có thể retry
    console.error(
      "⚠️  Server will continue but API endpoints will return 503 errors\n"
    );
  });

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

/**
 * POST check phone number exists (for login/forgot password)
 * Kiểm tra số điện thoại có tồn tại trong hệ thống không
 */
app.post(
  "/api/auth/check-phone-exists",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { phoneNumber } = req.body;

      if (
        !phoneNumber ||
        typeof phoneNumber !== "string" ||
        phoneNumber.trim() === ""
      ) {
        return res.status(400).json({
          error: "Vui lòng nhập số điện thoại",
          message: "Phone number is required",
        });
      }

      const phone = phoneNumber.trim();

      // Validate phone format (10-11 digits)
      if (!/^[0-9]{10,11}$/.test(phone)) {
        return res.status(400).json({
          error: "Số điện thoại không hợp lệ",
          message: "Invalid phone number format",
        });
      }

      // console.log(`[Auth] Checking if phone number exists: ${phone}`);

      // Check if phone number exists in users collection
      const existingUser = await usersCollection.findOne({
        Phone: phone,
      });

      if (!existingUser) {
        // console.log(`[Auth] Phone number not found: ${phone}`);
        return res.status(404).json({
          error: "Số điện thoại chưa được đăng ký",
          message: "Phone number not registered",
          exists: false,
        });
      }

      // console.log(`[Auth] Phone number exists: ${phone}`);
      res.json({
        success: true,
        message: "Số điện thoại đã được đăng ký",
        exists: true,
        user: {
          CustomerID: existingUser.CustomerID,
          FullName: existingUser.FullName || "",
          Phone: existingUser.Phone,
        },
      });
    } catch (error) {
      console.error("[Auth] Error checking phone exists:", error);
      res.status(500).json({
        error: "Lỗi kiểm tra số điện thoại",
        message: error.message,
      });
    }
  }
);

/**
 * POST check phone number availability for registration
 * Kiểm tra số điện thoại có thể dùng để đăng ký không (chưa tồn tại)
 */
app.post("/api/auth/check-phone", checkMongoConnection, async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (
      !phoneNumber ||
      typeof phoneNumber !== "string" ||
      phoneNumber.trim() === ""
    ) {
      return res.status(400).json({
        error: "Vui lòng nhập số điện thoại",
        message: "Phone number is required",
      });
    }

    const phone = phoneNumber.trim();

    // Validate phone format (10-11 digits)
    if (!/^[0-9]{10,11}$/.test(phone)) {
      return res.status(400).json({
        error: "Số điện thoại không hợp lệ",
        message: "Invalid phone number format",
      });
    }

    // console.log(`[Auth] Checking phone number availability: ${phone}`);

    // Check if phone number already exists in users collection
    const existingUser = await usersCollection.findOne({
      Phone: phone,
    });

    if (existingUser) {
      // console.log(`[Auth] Phone number already exists: ${phone}`);
      return res.status(400).json({
        error: "Số điện thoại đã được đăng ký",
        message: "Phone number already registered",
      });
    }

    // console.log(`[Auth] Phone number is available: ${phone}`);
    res.json({
      success: true,
      message: "Số điện thoại có thể sử dụng",
      available: true,
    });
  } catch (error) {
    console.error("[Auth] Error checking phone:", error);
    res.status(500).json({
      error: "Lỗi kiểm tra số điện thoại",
      message: error.message,
    });
  }
});

/**
 * POST user login (phone number or email)
 * Hỗ trợ đăng nhập bằng số điện thoại hoặc email cho user (không phải admin)
 */
app.post("/api/auth/login", checkMongoConnection, async (req, res) => {
  try {
    const { phoneNumber, password, email } = req.body;

    // Nếu có email, đây là admin login
    if (email) {
      //  console.log("\n🔐 === ADMIN LOGIN REQUEST ===");
      // console.log(`📧 Email: ${email}`);
      // console.log(`🔑 Password: ${password ? "***" : "empty"}`);

      // Bước 1: Tìm trong collection admins
      // console.log("🔍 Step 1: Searching in admins collection...");
      let admin = await adminsCollection.findOne({ email: email });

      if (admin) {
        // console.log("✅ Admin found in admins collection!");
        // console.log(`   - ID: ${admin.id}`);
        // console.log(`   - Name: ${admin.name}`);
        // console.log(`   - Email: ${admin.email}`);

        // Kiểm tra password
        if (admin.password !== password) {
          // console.log("❌ Invalid password for admin");
          return res
            .status(401)
            .json({ error: "Email hoặc mật khẩu không đúng" });
        }

        // console.log("✅ Password verified!");

        // Tạo token
        const token = "admin_token_" + Date.now() + "_" + admin.id;

        // Trả về thông tin admin
        const adminResponse = {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role || "admin",
        };

        // console.log("✅ Login successful!");
        // console.log("======================\n");

        return res.json({
          token: token,
          user: adminResponse,
        });
      }

      // Bước 2: Nếu không tìm thấy trong admins, tìm trong users với role admin
      // console.log("⚠️  Admin not found in admins collection");
      // console.log(
      //   "🔍 Step 2: Searching in users collection with role=admin..."
      // );

      const user = await usersCollection.findOne({
        email: email,
        role: "admin",
      });

      if (!user) {
        // console.log("❌ Admin not found in any collection");
        // console.log("======================\n");
        return res
          .status(401)
          .json({ error: "Email hoặc mật khẩu không đúng" });
      }

      // console.log("✅ Admin found in users collection!");
      // console.log(`   - ID: ${user.user_id}`);
      // console.log(`   - Name: ${user.name}`);

      // Kiểm tra password
      if (user.password !== password) {
        // console.log("❌ Invalid password");
        // console.log("======================\n");
        return res
          .status(401)
          .json({ error: "Email hoặc mật khẩu không đúng" });
      }

      // console.log("✅ Password verified!");

      // Tạo token
      const token = "admin_token_" + Date.now() + "_" + user.user_id;

      // Trả về thông tin user
      const userResponse = {
        id: user.user_id,
        email: user.email,
        name: user.name,
        role: user.role,
      };

      // console.log("✅ Login successful!");
      // console.log("======================\n");

      return res.json({
        token: token,
        user: userResponse,
      });
    }

    // Nếu có phoneNumber, đây là user login (không phải admin)
    if (phoneNumber) {
      // console.log("\n🔐 === USER LOGIN REQUEST ===");
      // console.log(`📱 Phone: ${phoneNumber}`);
      // console.log(`🔑 Password: ${password ? "***" : "empty"}`);

      if (!password) {
        return res.status(400).json({ error: "Vui lòng nhập mật khẩu" });
      }

      // Tìm user theo số điện thoại
      const user = await usersCollection.findOne({
        Phone: phoneNumber.trim(),
      });

      if (!user) {
        // console.log("❌ User not found");
        // console.log("======================\n");
        return res
          .status(404)
          .json({ error: "Số điện thoại chưa được đăng ký" });
      }

      // console.log("✅ User found!");
      // console.log(`   - CustomerID: ${user.CustomerID}`);
      // console.log(`   - FullName: ${user.FullName || "N/A"}`);

      // Kiểm tra password
      // Password có thể được hash bằng bcrypt hoặc lưu plain text
      let passwordMatch = false;

      // Check if password is hashed (bcrypt starts with $2b$)
      if (user.Password && user.Password.startsWith("$2b$")) {
        // Password is hashed - dùng bcrypt.compare để so sánh
        // console.log("🔐 Password is hashed, using bcrypt.compare...");
        try {
          passwordMatch = await bcrypt.compare(password, user.Password);
          // console.log(`   Password match: ${passwordMatch}`);
        } catch (bcryptError) {
          // console.error("❌ Bcrypt compare error:", bcryptError);
          return res.status(500).json({ error: "Lỗi xác minh mật khẩu" });
        }
      } else {
        // Password is plain text - so sánh trực tiếp (backward compatibility)
        // console.log("📝 Password is plain text, comparing directly...");
        passwordMatch = user.Password === password;
      }

      if (!passwordMatch) {
        // console.log("❌ Invalid password");
        // console.log("======================\n");
        return res.status(401).json({ error: "Mật khẩu không chính xác" });
      }

      // console.log("✅ Password verified!");

      // Tạo token
      const token = "user_token_" + Date.now() + "_" + user.CustomerID;

      // Trả về thông tin user
      const userResponse = {
        CustomerID: user.CustomerID,
        Phone: user.Phone,
        FullName: user.FullName || "",
        Email: user.Email || "",
        Address: user.Address || "",
        RegisterDate: user.RegisterDate || new Date(),
        CustomerType: user.CustomerType || "",
        CustomerTiering: user.CustomerTiering || "Đồng",
      };

      // console.log("✅ Login successful!");
      // console.log("======================\n");

      return res.json({
        token: token,
        user: userResponse,
        message: "Đăng nhập thành công",
      });
    }

    // Không có email hoặc phoneNumber
    return res.status(400).json({
      error: "Vui lòng nhập email hoặc số điện thoại",
      message: "Email or phone number is required",
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    // console.log("======================\n");
    res.status(500).json({ error: "Lỗi đăng nhập", message: error.message });
  }
});

/**
 * PUT update user information by CustomerID
 * Cập nhật thông tin user theo CustomerID (cho frontend my-user)
 */
app.put("/api/auth/user/update", checkMongoConnection, async (req, res) => {
  try {
    const { customerID, fullName, email, birthDay, gender, address } = req.body;

    // console.log("\n📝 === UPDATE USER INFO REQUEST ===");
    // console.log(`📱 CustomerID: ${customerID}`);
    // console.log(`👤 FullName: ${fullName || "N/A"}`);
    // console.log(`📧 Email: ${email || "N/A"}`);
    // console.log(`🎂 BirthDay: ${birthDay || "N/A"}`);
    // console.log(`⚧️ Gender: ${gender || "N/A"}`);
    // console.log(`📍 Address: ${address || "N/A"}`);

    // Validate CustomerID
    if (!customerID) {
      return res.status(400).json({
        error: "CustomerID là bắt buộc",
        message: "CustomerID is required",
      });
    }

    // Build update object
    const updateData = {};

    if (fullName !== undefined) {
      updateData.FullName = fullName; // Có thể là null để xóa
    }
    if (email !== undefined && email) {
      updateData.Email = email.trim();
    }
    if (birthDay !== undefined) {
      updateData.BirthDay = birthDay;
    }
    if (gender !== undefined) {
      updateData.Gender = gender;
    }
    if (address !== undefined) {
      updateData.Address = address;
    }

    // Add updatedAt timestamp
    updateData.updatedAt = new Date();

    // console.log("📋 Update data:", updateData);

    // Update user in MongoDB
    const result = await usersCollection.updateOne(
      { CustomerID: customerID },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      // console.log(`❌ User not found with CustomerID: ${customerID}`);
      return res.status(404).json({
        error: "Không tìm thấy người dùng",
        message: "User not found",
      });
    }

    // Get updated user data
    const updatedUser = await usersCollection.findOne({
      CustomerID: customerID,
    });

    if (!updatedUser) {
      return res.status(500).json({
        error: "Lỗi khi lấy thông tin người dùng sau khi cập nhật",
        message: "Error fetching updated user",
      });
    }

    // console.log("✅ User updated successfully!");
    // console.log("======================\n");

    // Return updated user data
    const userResponse = {
      CustomerID: updatedUser.CustomerID,
      Phone: updatedUser.Phone,
      FullName: updatedUser.FullName || null,
      Email: updatedUser.Email || null,
      Address: updatedUser.Address || null,
      BirthDay: updatedUser.BirthDay || null,
      Gender: updatedUser.Gender || null,
      RegisterDate: updatedUser.RegisterDate,
      CustomerType: updatedUser.CustomerType || "",
      CustomerTiering: updatedUser.CustomerTiering || "Đồng",
    };

    // Tự động đồng bộ users về JSON sau khi cập nhật
    syncUsersToJsonAsync(usersCollection);

    res.json({
      success: true,
      message: "Cập nhật thông tin thành công",
      data: userResponse,
    });
  } catch (error) {
    console.error("❌ Error updating user info:", error);
    // console.log("======================\n");
    res.status(500).json({
      error: "Lỗi cập nhật thông tin",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST user registration
 * Đăng ký tài khoản mới cho user
 */
app.post("/api/auth/register", checkMongoConnection, async (req, res) => {
  try {
    const { phoneNumber, password, fullName, email, address } = req.body;

    // console.log("\n📝 === REGISTRATION REQUEST ===");
    // console.log(`📱 Phone: ${phoneNumber}`);
    // console.log(`👤 FullName: ${fullName || "N/A"}`);

    // Validate required fields
    if (
      !phoneNumber ||
      typeof phoneNumber !== "string" ||
      phoneNumber.trim() === ""
    ) {
      return res.status(400).json({
        error: "Vui lòng nhập số điện thoại",
        message: "Phone number is required",
      });
    }

    if (!password || typeof password !== "string" || password.trim() === "") {
      return res.status(400).json({
        error: "Vui lòng nhập mật khẩu",
        message: "Password is required",
      });
    }

    const phone = phoneNumber.trim();

    // Validate phone format
    if (!/^[0-9]{10,11}$/.test(phone)) {
      return res.status(400).json({
        error: "Số điện thoại không hợp lệ",
        message: "Invalid phone number format",
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        error: "Mật khẩu phải có ít nhất 6 ký tự",
        message: "Password must be at least 6 characters",
      });
    }

    // Check if phone number already exists
    const existingUser = await usersCollection.findOne({ Phone: phone });

    if (existingUser) {
      // console.log(`❌ Phone number already exists: ${phone}`);
      return res.status(400).json({
        error: "Số điện thoại đã được đăng ký",
        message: "Phone number already registered",
      });
    }

    // Generate CustomerID (format: auto-increment based on existing users)
    const userCount = await usersCollection.countDocuments();
    const customerID = `CUS${String(userCount + 1).padStart(6, "0")}`;

    // console.log(`📋 Generated CustomerID: ${customerID}`);

    // Hash password với bcrypt trước khi lưu vào database
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user document
    const newUser = {
      CustomerID: customerID,
      Phone: phone,
      Password: hashedPassword, // Password đã được hash bằng bcrypt
      FullName: fullName || "",
      Email: email || "",
      Address: address || "",
      RegisterDate: new Date(),
      CustomerType: "",
      CustomerTiering: "Đồng",
      TotalSpent: 0,
      PasswordVersion: 1,
      LastPasswordReset: null,
    };

    // Insert user into database
    const result = await usersCollection.insertOne(newUser);

    // console.log(`✅ User registered successfully!`);
    // console.log(`   - CustomerID: ${customerID}`);
    // console.log(`   - Phone: ${phone}`);
    // console.log(`   - FullName: ${fullName || "N/A"}`);
    // console.log("====================================\n");

    // Create token for auto-login
    const token = "user_token_" + Date.now() + "_" + customerID;

    // Return user data
    const userResponse = {
      CustomerID: customerID,
      Phone: phone,
      FullName: fullName || "",
      Email: email || "",
      Address: address || "",
      RegisterDate: newUser.RegisterDate,
      CustomerType: "",
      CustomerTiering: "Đồng",
    };

    // Tự động đồng bộ users về JSON sau khi đăng ký
    syncUsersToJsonAsync(usersCollection);

    res.json({
      success: true,
      message: "Đăng ký thành công",
      token: token,
      user: userResponse,
    });
  } catch (error) {
    console.error("❌ Registration error:", error);
    // console.log("====================================\n");
    res.status(500).json({
      error: "Lỗi đăng ký",
      message: error.message,
    });
  }
});

/**
 * POST request password reset
 * Gửi OTP qua email thật sử dụng Gmail: vgreenhotro@gmail.com
 */
app.post(
  "/api/auth/forgot-password",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { email } = req.body;

      // Validate input
      if (!email || typeof email !== "string" || email.trim() === "") {
        return res.status(400).json({
          error: "Vui lòng nhập địa chỉ email hợp lệ",
        });
      }

      const emailLower = email.toLowerCase().trim();

      // console.log("\n🔐 === FORGOT PASSWORD REQUEST ===");
      // console.log(`📧 Email: ${emailLower}`);

      // Bước 1: Tìm admin trong collection admins
      // console.log("🔍 Searching for admin in admins collection...");
      let admin = await adminsCollection.findOne({ email: emailLower });

      if (!admin) {
        console.log(
          "⚠️  Admin not found in admins collection, checking users..."
        );
        // Bước 2: Tìm trong users với role admin
        admin = await usersCollection.findOne({
          email: emailLower,
          role: "admin",
        });
      }

      if (!admin) {
        console.log("❌ Admin not found in any collection");
        console.log("====================================\n");
        return res.status(404).json({
          success: false,
          error: "Email không tồn tại trong hệ thống",
        });
      }

      console.log("✅ Admin found!");
      console.log(`   Name: ${admin.name || "N/A"}`);
      console.log(`   Email: ${admin.email}`);

      // Bước 3: Tạo OTP ngẫu nhiên
      const otp = generateOTP();
      console.log(`🔑 OTP generated: ${otp}`);

      // Bước 4: Lưu OTP vào database
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 phút

      let collectionToUpdate;
      // Lưu vào collection tương ứng
      if (await adminsCollection.findOne({ email: emailLower })) {
        collectionToUpdate = adminsCollection;
      } else {
        collectionToUpdate = usersCollection;
      }

      const updateResult = await collectionToUpdate.updateOne(
        { email: emailLower },
        {
          $set: {
            reset_otp: otp,
            reset_otp_expires: otpExpiry,
            updated_at: new Date(),
          },
        }
      );

      if (updateResult.matchedCount === 0) {
        console.log("❌ Failed to update OTP in database");
        return res.status(500).json({
          success: false,
          error: "Không thể lưu mã OTP. Vui lòng thử lại.",
        });
      }

      console.log("✅ OTP saved to database");
      console.log(`   Expires at: ${otpExpiry.toLocaleString("vi-VN")}`);

      // Bước 5: GỬI OTP QUA EMAIL
      console.log("📧 Sending OTP via email...");
      const emailResult = await sendOTPEmail(
        emailLower,
        admin.name || "Quản trị viên",
        otp
      );

      if (!emailResult.success) {
        console.log("❌ Failed to send email");
        console.log(`   Error: ${emailResult.error}`);
        console.log("====================================\n");
        return res.status(500).json({
          success: false,
          error: "Không thể gửi email. Vui lòng thử lại sau.",
          details: emailResult.error,
        });
      }

      console.log("✅ OTP email sent successfully!");
      console.log("====================================\n");

      res.json({
        success: true,
        message:
          "Mã OTP đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư.",
        email: emailLower,
      });
    } catch (error) {
      console.error("❌ Forgot password error:", error);
      console.error("   Stack:", error.stack);
      console.log("====================================\n");

      // Provide more specific error messages
      if (error.code === "ECONNREFUSED" || error.message.includes("connect")) {
        return res.status(503).json({
          success: false,
          error: "Không thể kết nối với database. Vui lòng thử lại sau.",
        });
      }

      res.status(500).json({
        success: false,
        error: "Lỗi xử lý yêu cầu. Vui lòng thử lại sau.",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
);

/**
 * POST verify OTP
 * Xác thực mã OTP trước khi cho phép đặt lại mật khẩu
 */
app.post("/api/auth/verify-otp", checkMongoConnection, async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log("\n🔍 === VERIFY OTP REQUEST ===");
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 OTP: ${otp}`);

    // Tìm admin với OTP
    let admin = await adminsCollection.findOne({
      email: email,
      reset_otp: otp,
    });

    if (!admin) {
      // console.log("⚠️  Not found in admins, checking users...");
      admin = await usersCollection.findOne({
        email: email,
        reset_otp: otp,
      });
    }

    if (!admin) {
      // console.log("❌ OTP không đúng");
      // console.log("===========================\n");
      return res.status(400).json({
        success: false,
        error: "Mã OTP không đúng. Vui lòng kiểm tra lại.",
      });
    }

    // Kiểm tra OTP còn hạn không
    if (
      admin.reset_otp_expires &&
      new Date() > new Date(admin.reset_otp_expires)
    ) {
      // console.log("❌ OTP đã hết hạn");
      // console.log(
      //   `   Expired at: ${new Date(admin.reset_otp_expires).toLocaleString(
      //     "vi-VN"
      //   )}`
      // );
      // console.log("===========================\n");
      return res.status(400).json({
        success: false,
        error: "Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.",
      });
    }

    // console.log("✅ OTP hợp lệ!");
    // console.log("===========================\n");

    res.json({
      success: true,
      message: "Mã OTP hợp lệ. Bạn có thể đặt mật khẩu mới.",
      email: email,
    });
  } catch (error) {
    console.error("❌ Verify OTP error:", error);
    // console.log("===========================\n");
    res.status(500).json({
      success: false,
      error: "Lỗi xử lý yêu cầu",
    });
  }
});

/**
 * POST reset password
 * Đặt lại mật khẩu sau khi verify OTP
 */
app.post("/api/auth/reset-password", checkMongoConnection, async (req, res) => {
  try {
    const { email, otp, newPassword, phoneNumber } = req.body;

    // console.log("\n🔐 === RESET PASSWORD REQUEST ===");
    // console.log("📦 Request body:", {
    //   email,
    //   phoneNumber,
    //   hasOtp: !!otp,
    //   hasNewPassword: !!newPassword,
    // });

    // Xử lý 2 trường hợp: email/OTP hoặc phoneNumber
    if (phoneNumber && newPassword) {
      // Trường hợp 1: Reset password bằng phoneNumber (user-facing)
      // console.log("📱 Phone number reset password flow");
      // console.log(`📱 Phone: ${phoneNumber}`);

      // Validate password mới
      if (!newPassword || newPassword.length < 6) {
        // console.log("❌ Invalid new password");
        // console.log("===================================\n");
        return res
          .status(400)
          .json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
      }

      // Tìm user theo số điện thoại
      const user = await usersCollection.findOne({ Phone: phoneNumber });
      if (!user) {
        // console.log("❌ User not found");
        // console.log("===================================\n");
        return res.status(404).json({ error: "Không tìm thấy người dùng" });
      }

      // console.log("✅ User found");

      // Hash password mới trước khi lưu
      // console.log("🔐 Hashing new password...");
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
      // console.log("✅ Password hashed successfully");

      // Cập nhật password mới (đã hash)
      // console.log("🔄 Updating password in MongoDB...");
      await usersCollection.updateOne(
        { Phone: phoneNumber },
        {
          $set: {
            Password: hashedPassword,
            PasswordVersion: (user.PasswordVersion || 0) + 1,
            LastPasswordReset: new Date(),
            updated_at: new Date(),
          },
        }
      );

      // console.log("✅ Password updated successfully!");
      // console.log("===================================\n");

      return res.json({
        success: true,
        message:
          "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập với mật khẩu mới.",
      });
    }

    // Trường hợp 2: Reset password bằng email/OTP (admin hoặc email-based)
    if (email && otp && newPassword) {
      // console.log("📧 Email/OTP reset password flow");
      // console.log(`📧 Email: ${email}`);
      // console.log(`🔑 OTP: ${otp}`);

      // Bước 1: Tìm admin trong collection admins
      // console.log("🔍 Searching for admin with OTP...");
      let admin = await adminsCollection.findOne({
        email: email,
        reset_otp: otp,
      });

      let collection = adminsCollection;

      if (!admin) {
        // console.log("⚠️  Not found in admins, checking users...");
        // Bước 2: Tìm trong users
        admin = await usersCollection.findOne({
          email: email,
          reset_otp: otp,
        });
        collection = usersCollection;
      }

      if (!admin) {
        // console.log("❌ Admin not found or OTP incorrect");
        // console.log("===================================\n");
        return res.status(400).json({ error: "Mã OTP không đúng" });
      }

      // console.log("✅ Admin found with matching OTP!");

      // Bước 3: Kiểm tra OTP còn hạn không
      if (
        admin.reset_otp_expires &&
        new Date() > new Date(admin.reset_otp_expires)
      ) {
        // console.log("❌ OTP expired");
        // console.log(
        //   `   Expired at: ${new Date(admin.reset_otp_expires).toLocaleString(
        //     "vi-VN"
        //   )}`
        // );
        // console.log("===================================\n");
        return res
          .status(400)
          .json({ error: "Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới." });
      }

      // console.log("✅ OTP is valid and not expired");

      // Bước 4: Validate password mới
      if (!newPassword || newPassword.length < 6) {
        // console.log("❌ Invalid new password");
        // console.log("===================================\n");
        return res
          .status(400)
          .json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
      }

      // Bước 5: Hash password mới trước khi lưu
      // console.log("🔐 Hashing new password...");
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
      // console.log("✅ Password hashed successfully");

      // Bước 6: Cập nhật password mới (đã hash) và xóa OTP
      // console.log("🔄 Updating password and clearing OTP...");
      await collection.updateOne(
        { email: email },
        {
          $set: {
            password: hashedPassword,
            updated_at: new Date(),
          },
          $unset: {
            reset_otp: "",
            reset_otp_expires: "",
          },
        }
      );

      // console.log("✅ Password updated successfully!");
      // console.log("===================================\n");

      return res.json({
        success: true,
        message:
          "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập với mật khẩu mới.",
      });
    }

    // Nếu không có đủ thông tin
    // console.log("❌ Invalid request: missing required fields");
    // console.log("===================================\n");
    return res.status(400).json({ error: "Thiếu thông tin bắt buộc" });
  } catch (error) {
    console.error("❌ Reset password error:", error);
    // console.log("===================================\n");
    res.status(500).json({ error: "Lỗi xử lý yêu cầu" });
  }
});

/**
 * POST change password
 * Đổi mật khẩu khi đã đăng nhập (yêu cầu mật khẩu cũ)
 */
app.post(
  "/api/auth/change-password",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { customerID, currentPassword, newPassword } = req.body;

      // console.log("\n🔐 === CHANGE PASSWORD REQUEST ===");
      //    console.log("📦 Request body:", {
      // customerID,
      //   hasCurrentPassword: !!currentPassword,
      //   hasNewPassword: !!newPassword,
      // });

      // Validate input
      if (!customerID || !currentPassword || !newPassword) {
        // console.log("❌ Missing required fields");
        // console.log("===================================\n");
        return res.status(400).json({
          success: false,
          error:
            "Thiếu thông tin bắt buộc: customerID, currentPassword, newPassword",
        });
      }

      // Validate new password: min 8 characters, at least 1 uppercase letter
      if (newPassword.length < 8) {
        // console.log("❌ New password too short");
        // console.log("===================================\n");
        return res.status(400).json({
          success: false,
          error: "Mật khẩu mới phải có ít nhất 8 ký tự",
        });
      }

      if (!/^(?=.*[A-Z])/.test(newPassword)) {
        // console.log("❌ New password missing uppercase letter");
        // console.log("===================================\n");
        return res.status(400).json({
          success: false,
          error: "Mật khẩu mới phải có ít nhất 1 chữ cái in hoa",
        });
      }

      // Tìm user theo CustomerID
      const user = await usersCollection.findOne({ CustomerID: customerID });
      if (!user) {
        // console.log("❌ User not found");
        // console.log("===================================\n");
        return res.status(404).json({
          success: false,
          error: "Không tìm thấy người dùng",
        });
      }

      // console.log("✅ User found");

      // Xác minh mật khẩu cũ
      // console.log("🔐 Verifying current password...");
      const isCurrentPasswordValid = await bcrypt.compare(
        currentPassword,
        user.Password
      );

      if (!isCurrentPasswordValid) {
        // console.log("❌ Current password is incorrect");
        // console.log("===================================\n");
        return res.status(400).json({
          success: false,
          error: "Mật khẩu hiện tại không đúng",
        });
      }

      // console.log("✅ Current password verified");

      // Hash mật khẩu mới
      // console.log("🔐 Hashing new password...");
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
      // console.log("✅ Password hashed successfully");

      // Cập nhật mật khẩu với version tracking
      // console.log("🔄 Updating password in MongoDB...");
      const passwordVersion = (user.PasswordVersion || 0) + 1;
      const lastPasswordReset = new Date();

      await usersCollection.updateOne(
        { CustomerID: customerID },
        {
          $set: {
            Password: hashedPassword,
            PasswordVersion: passwordVersion,
            LastPasswordReset: lastPasswordReset,
          },
        }
      );

      // console.log("✅ Password updated successfully!");
      // console.log("   PasswordVersion:", passwordVersion);
      // console.log("   LastPasswordReset:", lastPasswordReset);
      // console.log("===================================\n");

      return res.json({
        success: true,
        message: "Đổi mật khẩu thành công",
      });
    } catch (error) {
      console.error("❌ Error in change-password:", error);
      // console.log("===================================\n");
      return res.status(500).json({
        success: false,
        error: "Lỗi server khi đổi mật khẩu",
        details: error.message,
      });
    }
  }
);

// ============================================================================
// USERS / CUSTOMERS ENDPOINTS
// ============================================================================

/**
 * GET all users
 */
app.get("/api/users", checkMongoConnection, async (req, res) => {
  try {
    const { group } = req.query; // Filter by group if provided

    // console.log("\n📋 === GET ALL USERS (CUSTOMERS) ===");
    // console.log(`📊 Filter by group: ${group || "all"}`);

    // Build query
    let query = {};
    if (group && group !== "all") {
      query.groups = group; // Filter by group name
    }

    // Load users from MongoDB
    const users = await usersCollection.find(query).toArray();
    // console.log(`✅ Found ${users.length} users in MongoDB`);

    // Remove password from response
    const usersWithoutPassword = users.map((user) => {
      const { Password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    // console.log(
    //   `✅ Returning ${usersWithoutPassword.length} users (passwords removed)`
    // );
    // console.log("📋 Data source: MongoDB (users collection)\n");

    // Return array directly (not wrapped in object)
    res.json(usersWithoutPassword);
  } catch (error) {
    console.error("❌ Error fetching users from MongoDB:", error);
    console.error("❌ Error details:", error.message);
    res.status(500).json({
      error: "Failed to fetch users",
      message: error.message,
    });
  }
});

/**
 * GET user by ID
 */
app.get("/api/users/:id", checkMongoConnection, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await usersCollection.findOne({ user_id: userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

/**
 * GET user by CustomerID (for admin customer detail)
 */
app.get(
  "/api/users/customer/:customerID",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { customerID } = req.params;

      // console.log(`\n📋 === GET CUSTOMER DETAIL ===`);
      // console.log(`📱 CustomerID: ${customerID}`);

      if (!customerID) {
        return res.status(400).json({
          error: "CustomerID là bắt buộc",
          message: "CustomerID is required",
        });
      }

      // Find user by CustomerID in MongoDB
      const user = await usersCollection.findOne({ CustomerID: customerID });

      if (!user) {
        // console.log(`❌ Customer not found: ${customerID}`);
        return res.status(404).json({
          error: "Không tìm thấy khách hàng",
          message: "Customer not found",
        });
      }

      // console.log(`✅ Found customer: ${user.CustomerID}`);

      // Return full user data (excluding password)
      const userData = { ...user };
      delete userData.Password;

      res.json({
        success: true,
        customer: userData,
      });
    } catch (error) {
      console.error("❌ Error fetching customer:", error);
      res.status(500).json({
        error: "Lỗi server khi lấy thông tin khách hàng",
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/users/metadata/groups - Lấy danh sách tất cả user groups
 */
app.get(
  "/api/users/metadata/groups",
  checkMongoConnection,
  async (req, res) => {
    try {
      // Get all unique group names from users
      const users = await usersCollection.find({}).toArray();
      const groupsSet = new Set();

      users.forEach((user) => {
        if (user.groups && Array.isArray(user.groups)) {
          user.groups.forEach((group) => {
            if (group && group.trim() !== "") {
              groupsSet.add(group.trim());
            }
          });
        }
      });

      const groups = Array.from(groupsSet).sort();

      res.json({
        success: true,
        data: groups,
        count: groups.length,
      });
    } catch (error) {
      console.error("❌ [Users API] Error fetching groups:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy danh sách groups",
        error: error.message,
      });
    }
  }
);

/**
 * POST create new user
 * Lưu ý: Endpoint này có thể được dùng bởi admin hoặc import script
 * Nếu có password trong request, phải hash trước khi lưu vào database
 */
app.post("/api/users", checkMongoConnection, async (req, res) => {
  try {
    const newUser = { ...req.body };

    // Nếu có password trong request, hash nó trước khi lưu
    if (newUser.Password && !newUser.Password.startsWith("$2b$")) {
      // Password chưa được hash (không bắt đầu bằng $2b$ - prefix của bcrypt)
      // console.log("🔐 Hashing password before saving user...");
      const saltRounds = 10;
      newUser.Password = await bcrypt.hash(newUser.Password, saltRounds);
      // console.log("✅ Password hashed successfully");
    }

    const result = await usersCollection.insertOne(newUser);

    // Tự động đồng bộ users về JSON sau khi tạo mới
    syncUsersToJsonAsync(usersCollection);

    res.status(201).json({ message: "User created", id: result.insertedId });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

/**
 * PUT update user by CustomerID (for admin)
 * Cập nhật thông tin user theo CustomerID và tự động sync về JSON
 */
app.put(
  "/api/users/customer/:customerID",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { customerID } = req.params;
      const updateData = req.body;

      //    console.log("\n📝 === UPDATE USER BY CUSTOMERID (ADMIN) ===");
      // console.log(`📱 CustomerID: ${customerID}`);
      // console.log("📋 Update data:", updateData);

      // Validate CustomerID
      if (!customerID) {
        return res.status(400).json({
          error: "CustomerID là bắt buộc",
          message: "CustomerID is required",
        });
      }

      // Map field names from frontend to MongoDB format
      // NOTE: CustomerTiering and CustomerType are LOCKED - do NOT update them
      const mappedData = {};

      // Basic information fields (allowed to update)
      if (updateData.fullName !== undefined)
        mappedData.FullName = updateData.fullName;
      if (updateData.name !== undefined) mappedData.FullName = updateData.name; // Support both formats
      if (updateData.email !== undefined) mappedData.Email = updateData.email;
      if (updateData.phone !== undefined) mappedData.Phone = updateData.phone;
      if (updateData.address !== undefined)
        mappedData.Address = updateData.address;

      // Gender field
      if (updateData.gender !== undefined) {
        // Gender is already in database format (male/female) from frontend
        mappedData.Gender = updateData.gender;
      }

      // Birthdate field - support both birthDay (ISO string) and birthdate (DD/MM/YYYY)
      if (
        updateData.birthDay !== undefined &&
        updateData.birthDay !== "" &&
        updateData.birthDay !== "---"
      ) {
        // birthDay is already in ISO string format from frontend
        try {
          mappedData.BirthDay = new Date(updateData.birthDay);
        } catch (e) {
          console.warn("⚠️ Invalid birthDay format:", updateData.birthDay);
        }
      } else if (
        updateData.birthdate !== undefined &&
        updateData.birthdate !== "---" &&
        updateData.birthdate !== ""
      ) {
        // Parse DD/MM/YYYY or DD-MM-YYYY to Date
        let dateObj = null;
        if (updateData.birthdate.includes("/")) {
          const dateParts = updateData.birthdate.split("/");
          if (dateParts.length === 3) {
            const day = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]) - 1;
            const year = parseInt(dateParts[2]);
            dateObj = new Date(year, month, day);
          }
        } else if (updateData.birthdate.includes("-")) {
          const dateParts = updateData.birthdate.split("-");
          if (dateParts.length === 3) {
            const day = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]) - 1;
            const year = parseInt(dateParts[2]);
            dateObj = new Date(year, month, day);
          }
        }
        if (dateObj && !isNaN(dateObj.getTime())) {
          mappedData.BirthDay = dateObj;
        }
      }

      // DO NOT update CustomerTiering or CustomerType - they are locked
      // These fields should only be updated through other admin functions, not customer detail edit

      // Add updatedAt timestamp
      mappedData.updatedAt = new Date();

      // console.log("📋 Mapped update data:", mappedData);

      // Update user in MongoDB
      const result = await usersCollection.updateOne(
        { CustomerID: customerID },
        { $set: mappedData }
      );

      if (result.matchedCount === 0) {
        // console.log(`❌ User not found: ${customerID}`);
        return res.status(404).json({
          success: false,
          error: "User not found",
          message: `User with CustomerID ${customerID} not found`,
        });
      }

      // console.log(`✅ User ${customerID} updated successfully`);
      // console.log(`   - Modified count: ${result.modifiedCount}`);
      // console.log(`   - Matched count: ${result.matchedCount}`);

      // Get updated user data from MongoDB
      const updatedUser = await usersCollection.findOne({
        CustomerID: customerID,
      });

      if (!updatedUser) {
        console.error(
          `❌ Error: User ${customerID} was updated but not found when retrieving`
        );
        return res.status(500).json({
          success: false,
          error: "User was updated but could not be retrieved",
          message: "Internal server error",
        });
      }

      // Remove password from response
      const { Password, ...userWithoutPassword } = updatedUser;

      // console.log("✅ Returning updated user data (password removed)");
      // console.log("📋 Data source: MongoDB (users collection)\n");

      res.json({
        success: true,
        message: "Đã cập nhật thông tin khách hàng thành công",
        customer: userWithoutPassword,
        data: userWithoutPassword,
      });
    } catch (error) {
      console.error("❌ Error updating user:", error);
      res.status(500).json({
        error: "Failed to update user",
        message: error.message,
      });
    }
  }
);

/**
 * DELETE user
 */
app.delete("/api/users/:id", checkMongoConnection, async (req, res) => {
  try {
    const customerID = req.params.id; // CustomerID can be string like "CUS000004" or MongoDB _id

    // console.log(`\n🗑️ === DELETE CUSTOMER ===`);
    // console.log(`📱 CustomerID: ${customerID}`);

    // Try to find user by CustomerID first (most common case)
    let user = await usersCollection.findOne({ CustomerID: customerID });

    // If not found by CustomerID, try to find by _id (MongoDB ObjectId)
    if (!user) {
      try {
        // Check if the id is a valid MongoDB ObjectId
        if (ObjectId.isValid(customerID)) {
          user = await usersCollection.findOne({
            _id: new ObjectId(customerID),
          });
        }
      } catch (e) {
        // Ignore ObjectId parsing errors
        // console.log(`⚠️ ObjectId parsing failed for: ${customerID}`);
      }
    }

    // If still not found, try by user_id (numeric)
    if (!user) {
      const userId = parseInt(customerID);
      if (!isNaN(userId)) {
        user = await usersCollection.findOne({ user_id: userId });
      }
    }

    if (!user) {
      // console.log(`❌ Customer not found: ${customerID}`);
      return res.status(404).json({
        error: "Không tìm thấy khách hàng",
        message: "Customer not found",
      });
    }

    // console.log(`✅ Found customer: ${user.CustomerID || user._id}`);

    // Delete user by _id (MongoDB primary key)
    const result = await usersCollection.deleteOne({ _id: user._id });

    if (result.deletedCount === 0) {
      // console.log(`❌ Failed to delete customer: ${customerID}`);
      return res.status(404).json({
        error: "Không thể xóa khách hàng",
        message: "Failed to delete customer",
      });
    }

    // console.log(
    //   `✅ Deleted customer successfully: ${user.CustomerID || user._id}`
    // );

    // Tự động đồng bộ users về JSON sau khi xóa
    syncUsersToJsonAsync(usersCollection);

    res.json({
      success: true,
      message: "Đã xóa khách hàng thành công",
      deletedCustomer: {
        CustomerID: user.CustomerID,
        FullName: user.FullName || user.full_name,
      },
    });
  } catch (error) {
    console.error("❌ Error deleting user:", error);
    res.status(500).json({
      error: "Lỗi server khi xóa khách hàng",
      message: error.message,
    });
  }
});

/**
 * POST sync users from MongoDB to JSON
 * Đồng bộ users từ MongoDB về JSON file (có thể gọi thủ công)
 */
app.post("/api/users/sync", checkMongoConnection, async (req, res) => {
  try {
    // console.log("\n🔄 [Manual Sync] Đồng bộ users từ MongoDB về JSON...");
    const result = await syncUsersToJson(usersCollection);

    if (result.success) {
      res.json({
        success: true,
        message: `Đã đồng bộ ${result.count} users từ MongoDB về JSON`,
        count: result.count,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Lỗi khi đồng bộ",
        message: "Không thể đồng bộ users",
      });
    }
  } catch (error) {
    console.error("❌ Error syncing users:", error);
    res.status(500).json({
      error: "Lỗi khi đồng bộ users",
      message: error.message,
    });
  }
});

// ============================================================================
// USER GROUPS ROUTES
// ============================================================================

/**
 * POST /api/users/groups - Tạo nhóm và gán cho nhiều users
 */
app.post("/api/users/groups", checkMongoConnection, async (req, res) => {
  try {
    const { groupName, customerIDs } = req.body;

    if (!groupName || !groupName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tên nhóm không được để trống",
      });
    }

    if (
      !customerIDs ||
      !Array.isArray(customerIDs) ||
      customerIDs.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Danh sách CustomerID không được để trống",
      });
    }

    const trimmedGroupName = groupName.trim();

    // console.log(
    //   `👥 [Users API] Creating group "${trimmedGroupName}" for ${customerIDs.length} users`
    // );

    // Update all users to add this group
    const updateResult = await usersCollection.updateMany(
      { CustomerID: { $in: customerIDs } },
      { $addToSet: { groups: trimmedGroupName } } // $addToSet ensures no duplicates
    );

    // console.log(
    //   `✅ [Users API] Added group "${trimmedGroupName}" to ${updateResult.modifiedCount} users`
    // );

    // Get updated users (without passwords)
    const updatedUsers = await usersCollection
      .find({ CustomerID: { $in: customerIDs } })
      .toArray();
    const usersWithoutPassword = updatedUsers.map((user) => {
      const { Password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({
      success: true,
      message: `Đã tạo nhóm "${trimmedGroupName}" và gán cho ${updateResult.modifiedCount} người dùng`,
      data: {
        groupName: trimmedGroupName,
        userCount: updateResult.modifiedCount,
        users: usersWithoutPassword,
      },
    });
  } catch (error) {
    console.error("❌ [Users API] Error creating group:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo nhóm người dùng",
      error: error.message,
    });
  }
});

/**
 * PUT /api/users/customer/:customerID/groups - Thêm/xóa groups từ một user
 */
app.put(
  "/api/users/customer/:customerID/groups",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { customerID } = req.params;
      const { action, groupName } = req.body; // action: 'add' or 'remove'

      if (!action || !["add", "remove"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Action phải là 'add' hoặc 'remove'",
        });
      }

      if (!groupName || !groupName.trim()) {
        return res.status(400).json({
          success: false,
          message: "Tên nhóm không được để trống",
        });
      }

      const trimmedGroupName = groupName.trim();
      const user = await usersCollection.findOne({ CustomerID: customerID });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy người dùng",
        });
      }

      let updateOperator;
      if (action === "add") {
        updateOperator = { $addToSet: { groups: trimmedGroupName } };
        // console.log(
        //   `👥 [Users API] Adding group "${trimmedGroupName}" to user ${customerID}`
        // );
      } else {
        updateOperator = { $pull: { groups: trimmedGroupName } };
        // console.log(
        //   `👥 [Users API] Removing group "${trimmedGroupName}" from user ${customerID}`
        // );
      }

      const updateResult = await usersCollection.updateOne(
        { CustomerID: customerID },
        updateOperator
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Không thể cập nhật người dùng",
        });
      }

      // Get updated user (without password)
      const updatedUser = await usersCollection.findOne({
        CustomerID: customerID,
      });
      const { Password, ...userWithoutPassword } = updatedUser;

      // console.log(
      //   `✅ [Users API] User ${customerID} groups updated:`,
      //   updatedUser.groups
      // );

      res.json({
        success: true,
        message:
          action === "add"
            ? `Đã thêm người dùng vào nhóm "${trimmedGroupName}"`
            : `Đã xóa người dùng khỏi nhóm "${trimmedGroupName}"`,
        data: userWithoutPassword,
      });
    } catch (error) {
      console.error("❌ [Users API] Error updating user groups:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi cập nhật nhóm người dùng",
        error: error.message,
      });
    }
  }
);

/**
 * DELETE /api/users/groups/:groupName - Xóa nhóm khỏi tất cả users
 */
app.delete(
  "/api/users/groups/:groupName",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { groupName } = req.params;

      // console.log(
      //   `👥 [Users API] Removing group "${groupName}" from all users`
      // );

      // Remove group from all users
      const updateResult = await usersCollection.updateMany(
        { groups: groupName },
        { $pull: { groups: groupName } }
      );

      // console.log(
      //   `✅ [Users API] Removed group "${groupName}" from ${updateResult.modifiedCount} users`
      // );

      res.json({
        success: true,
        message: `Đã xóa nhóm "${groupName}" khỏi ${updateResult.modifiedCount} người dùng`,
        data: {
          groupName,
          userCount: updateResult.modifiedCount,
        },
      });
    } catch (error) {
      console.error("❌ [Users API] Error deleting group:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi xóa nhóm người dùng",
        error: error.message,
      });
    }
  }
);

/**
 * POST sync all collections from MongoDB to JSON
 * Đồng bộ tất cả collections từ MongoDB về JSON files (có thể gọi thủ công)
 */
app.post("/api/sync/all", checkMongoConnection, async (req, res) => {
  try {
    // console.log(
    //   "\n🔄 [Manual Sync All] Đồng bộ tất cả collections từ MongoDB về JSON..."
    // );
    const result = await syncAllCollectionsToJson(db);

    if (result.success) {
      const summary = result.results
        .filter((r) => r.success && !r.skipped && !r.empty)
        .map((r) => `${r.collection}: ${r.count} documents`)
        .join(", ");

      res.json({
        success: true,
        message: `Đã đồng bộ tất cả collections từ MongoDB về JSON`,
        results: result.results,
        summary: summary,
      });
    } else {
      res.status(500).json({
        success: false,
        error: "Lỗi khi đồng bộ",
        message: "Không thể đồng bộ collections",
      });
    }
  } catch (error) {
    console.error("❌ Error syncing all collections:", error);
    res.status(500).json({
      error: "Lỗi khi đồng bộ collections",
      message: error.message,
    });
  }
});

// ============================================================================
// ORDERS ENDPOINTS
// ============================================================================

/**
 * POST create new order
 */
app.post("/api/orders", checkMongoConnection, async (req, res) => {
  try {
    // console.log(
    //   "📦 [Orders - SERVER.JS] Received POST request to create order"
    // );
    // console.log(
    //   "📦 [Orders - SERVER.JS] Request body:",
    //   JSON.stringify(req.body, null, 2)
    // );

    const {
      CustomerID,
      shippingInfo,
      items,
      paymentMethod,
      subtotal,
      shippingFee,
      shippingDiscount,
      discount,
      vatRate,
      vatAmount,
      totalAmount,
      code,
      promotionName,
      wantInvoice,
      invoiceInfo,
      consultantCode,
    } = req.body;

    // Validate required fields
    if (!CustomerID || !shippingInfo || !items || items.length === 0) {
      console.error("❌ [Orders] Missing required fields:", {
        CustomerID: !!CustomerID,
        shippingInfo: !!shippingInfo,
        items: items?.length,
      });
      return res.status(400).json({
        success: false,
        message: "Missing required fields: CustomerID, shippingInfo, or items",
      });
    }

    // Validate shipping info
    if (
      !shippingInfo.fullName ||
      !shippingInfo.phone ||
      !shippingInfo.address ||
      !shippingInfo.address.city ||
      !shippingInfo.address.district ||
      !shippingInfo.address.ward ||
      !shippingInfo.address.detail
    ) {
      console.error("❌ [Orders] Missing shipping info:", {
        fullName: !!shippingInfo.fullName,
        phone: !!shippingInfo.phone,
        address: !!shippingInfo.address,
        city: !!shippingInfo.address?.city,
        district: !!shippingInfo.address?.district,
        ward: !!shippingInfo.address?.ward,
        detail: !!shippingInfo.address?.detail,
      });
      return res.status(400).json({
        success: false,
        message: "Missing required shipping information",
      });
    }

    // Validate numeric fields
    if (subtotal === undefined || totalAmount === undefined) {
      console.error("❌ [Orders] Missing numeric fields:", {
        subtotal,
        totalAmount,
      });
      return res.status(400).json({
        success: false,
        message: "Missing required fields: subtotal or totalAmount",
      });
    }

    // Generate unique OrderID
    const OrderID = generateOrderID();

    console.log("📦 [Orders] Creating order with data:", {
      OrderID,
      CustomerID,
      itemsCount: items.length,
      subtotal,
      totalAmount,
      shippingInfo: {
        fullName: shippingInfo.fullName,
        phone: shippingInfo.phone,
        address: shippingInfo.address,
      },
    });

    // Create new order using Mongoose Order model
    // Note: routes will be initialized by Mongoose default, we'll set it after creation
    const newOrder = new Order({
      OrderID,
      CustomerID,
      shippingInfo: {
        fullName: shippingInfo.fullName,
        phone: shippingInfo.phone,
        email: shippingInfo.email || "",
        address: {
          city: shippingInfo.address.city,
          district: shippingInfo.address.district,
          ward: shippingInfo.address.ward,
          detail: shippingInfo.address.detail,
        },
        deliveryMethod: shippingInfo.deliveryMethod || "standard",
        warehouseAddress: shippingInfo.warehouseAddress || "",
        notes: shippingInfo.notes || "",
      },
      items: items.map((item, index) => {
        // Handle image field - convert array to string if needed
        let imageValue = "";
        if (item.image) {
          if (Array.isArray(item.image)) {
            // If image is array, take first element
            imageValue = item.image[0] || "";
          } else {
            imageValue = String(item.image);
          }
        }

        // Đảm bảo itemType có giá trị (mặc định là 'purchased')
        let itemType = item.itemType;
        if (!itemType || (itemType !== "purchased" && itemType !== "gifted")) {
          console.warn(
            `⚠️ [Orders] Invalid or missing itemType for item ${index}: ${itemType}, defaulting to 'purchased'`
          );
          itemType = "purchased";
        }

        // Đảm bảo originalPrice có giá trị (mặc định là price)
        const originalPrice = item.originalPrice || item.price || 0;

        // console.log(
        //   `📦 [Orders] Processing item ${index}: SKU=${item.sku}, itemType=${item.itemType}, finalItemType=${itemType}`
        // );

        return {
          sku: item.sku || "",
          productName: item.productName || "",
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          image: imageValue,
          unit: item.unit || "",
          category: item.category || "",
          subcategory: item.subcategory || "",
          itemType: itemType, // Đảm bảo itemType được set
          originalPrice: originalPrice, // Đảm bảo originalPrice được set
        };
      }),
      paymentMethod: paymentMethod || "cod",
      subtotal: Number(subtotal) || 0,
      shippingFee: Number(shippingFee) || 0,
      shippingDiscount: Number(shippingDiscount) || 0,
      discount: Number(discount) || 0,
      vatRate: Number(vatRate) || 0,
      vatAmount: Number(vatAmount) || 0,
      totalAmount: Number(totalAmount) || 0,
      code: code || "",
      promotionName: promotionName || "",
      wantInvoice: wantInvoice || false,
      invoiceInfo: invoiceInfo || {},
      consultantCode: consultantCode || "",
      status: "pending",
    });

    // Set routes after document creation (Mongoose Map)
    newOrder.routes.set("pending", new Date());

    // console.log("📦 [Orders] Order object created, attempting to save...");
    // console.log(
    //   "📦 [Orders] Order items before save:",
    //   JSON.stringify(
    //     newOrder.items.map((item) => ({
    //       sku: item.sku,
    //       productName: item.productName,
    //       itemType: item.itemType,
    //     })),
    //     null,
    //     2
    //   )
    // );

    // Save to database
    const savedOrder = await newOrder.save();

    // console.log(`✅ [Orders] Created new order: ${OrderID} for ${CustomerID}`);
    console.log(
      "📦 [Orders] Order items after save:",
      JSON.stringify(
        savedOrder.items.map((item) => ({
          sku: item.sku,
          productName: item.productName,
          itemType: item.itemType,
        })),
        null,
        2
      )
    );

    // ========== GIẢM TỒN KHO NGAY KHI ĐẶT HÀNG ==========
    // Giảm stock ngay khi đơn hàng được tạo (status = pending)
    // Để tránh trường hợp nhiều khách hàng đặt cùng lúc mà không có hàng
    // console.log(
    //   `📦 [Stock - SERVER.JS] Starting stock reduction for order ${OrderID}`
    // );
    try {
      // console.log(
      //   `📦 [Stock - SERVER.JS] Reducing stock for new order ${OrderID} (status: pending)`
      // );
      // console.log(
      //   `📦 [Stock - SERVER.JS] Order items count: ${savedOrder.items.length}`
      // );

      // Nhóm items theo SKU để tính tổng quantity (bao gồm cả purchased và gifted items)
      const stockReductionMap = new Map();

      for (const item of savedOrder.items) {
        if (item.sku && item.quantity && item.quantity > 0) {
          const currentTotal = stockReductionMap.get(item.sku) || 0;
          stockReductionMap.set(item.sku, currentTotal + item.quantity);
        }
      }

      // Giảm stock cho từng SKU
      for (const [sku, totalQuantity] of stockReductionMap.entries()) {
        // console.log(
        //   `📦 [Stock] Attempting to reduce stock for SKU ${sku}: quantity=${totalQuantity}`
        // );

        // Kiểm tra product có tồn tại không
        const productBefore = await Product.findOne({ sku: sku });
        if (!productBefore) {
          console.error(`❌ [Stock] Product not found for SKU: ${sku}`);
          continue;
        }

        // console.log(
        //   `📦 [Stock] Product found: SKU=${sku}, currentStock=${productBefore.stock}`
        // );

        // Giảm stock (không kiểm tra điều kiện stock >= quantity để đảm bảo luôn giảm)
        const updateResult = await Product.findOneAndUpdate(
          { sku: sku },
          { $inc: { stock: -totalQuantity } }, // Giảm stock
          { new: true }
        );

        if (updateResult) {
          // console.log(
          //   `✅ [Stock] Reduced stock for SKU ${sku}: ${
          //     updateResult.stock + totalQuantity
          //   } -> ${updateResult.stock} (total quantity: ${totalQuantity})`
          // );

          // Cảnh báo nếu stock âm
          if (updateResult.stock < 0) {
            console.warn(
              `⚠️ [Stock] Stock became negative for SKU ${sku}: ${updateResult.stock}`
            );
          }
        } else {
          console.error(`❌ [Stock] Failed to update stock for SKU: ${sku}`);
        }
      }
    } catch (stockError) {
      console.error(
        `❌ [Stock] Error reducing stock for new order ${OrderID}:`,
        stockError
      );
      // Don't fail the order creation if stock update fails
      // Nhưng có thể rollback order nếu cần (tùy business logic)
    }

    // Create notification for order creation (for user)
    try {
      await createOrderStatusNotification(
        CustomerID,
        OrderID,
        "pending",
        totalAmount
      );
    } catch (notifError) {
      console.error(
        "❌ [Notifications] Error creating order creation notification:",
        notifError
      );
      // Don't fail the request if notification creation fails
    }

    // Create notification for admin about new order
    try {
      await createAdminNotification(
        "new_order",
        OrderID,
        CustomerID,
        totalAmount,
        {
          title: "Đơn hàng mới",
          message: `Có đơn hàng mới #${OrderID} từ khách hàng ${CustomerID} với tổng giá trị ${totalAmount.toLocaleString(
            "vi-VN"
          )}₫`,
        }
      );
    } catch (adminNotifError) {
      console.error(
        "❌ [Notifications] Error creating admin notification for new order:",
        adminNotifError
      );
      // Don't fail the request if notification creation fails
    }

    // Tự động lưu promotion usage nếu có sử dụng mã khuyến mãi
    if (code && code.trim() !== "") {
      try {
        // Tìm promotion dựa vào code
        const promotion = await Promotion.findOne({ code: code.trim() });

        if (promotion) {
          // Tạo record trong promotion_usage
          const promotionUsage = new PromotionUsage({
            promotion_id: promotion._id.toString(),
            user_id: CustomerID,
            order_id: OrderID,
            used_at: new Date(),
          });

          await promotionUsage.save();
          // console.log(
          //   `✅ [PromotionUsage] Saved usage for promotion ${code} - Order ${OrderID}`
          // );
        } else {
          console.warn(
            `⚠️ [PromotionUsage] Promotion not found for code: ${code}`
          );
        }
      } catch (usageError) {
        // Log lỗi nhưng không fail toàn bộ request
        console.error(
          "❌ [PromotionUsage] Error saving promotion usage:",
          usageError
        );
      }
    }

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: newOrder,
    });
  } catch (error) {
    console.error("❌ [Orders] Error creating order:", error);
    console.error("❌ [Orders] Error stack:", error.stack);
    console.error("❌ [Orders] Error details:", {
      name: error.name,
      message: error.message,
      errors: error.errors,
    });

    // Provide more detailed error message
    let errorMessage = "Failed to create order";
    if (error.name === "ValidationError") {
      const validationErrors = Object.keys(error.errors || {}).map((key) => {
        return `${key}: ${error.errors[key].message}`;
      });
      errorMessage = `Validation failed: ${validationErrors.join(", ")}`;
    } else {
      errorMessage = error.message || "Failed to create order";
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message,
      details: error.errors || undefined,
    });
  }
});

/**
 * GET all orders
 */
app.get("/api/orders", checkMongoConnection, async (req, res) => {
  try {
    const { CustomerID } = req.query;

    // console.log(`\n📦 === GET ORDERS ===`);
    // console.log(`📱 CustomerID from query: ${CustomerID}`);

    let orders;
    if (CustomerID) {
      // Get orders by CustomerID
      orders = await ordersCollection
        .find({ CustomerID: CustomerID })
        .sort({ createdAt: -1 })
        .toArray();
      // console.log(
      //   `✅ Found ${orders.length} orders for customer ${CustomerID}`
      // );

      // Tự động xóa sản phẩm inactive khỏi đơn hàng pending/processing khi load
      let cleanedOrdersCount = 0;

      for (const order of orders) {
        // Chỉ xử lý đơn hàng pending/processing
        if (
          (order.status === "pending" || order.status === "processing") &&
          order.items &&
          order.items.length > 0
        ) {
          // Lấy tất cả SKUs từ đơn hàng
          const skus = order.items.map((item) => item.sku).filter(Boolean);

          if (skus.length > 0) {
            // Query tất cả sản phẩm active cùng lúc
            const activeProducts = await Product.find({
              sku: { $in: skus },
              status: "Active",
            }).select("sku");

            // Tạo Set các SKU active để lookup nhanh
            const activeSkus = new Set(activeProducts.map((p) => p.sku));

            // Lọc items: chỉ giữ lại sản phẩm active
            const activeItems = order.items.filter((item) => {
              const isActive = activeSkus.has(item.sku);
              if (!isActive) {
                // console.log(
                //   `🗑️ [Orders] Removing inactive product ${item.sku} (${
                //     item.productName || item.product_name || "N/A"
                //   }) from order ${order.OrderID || order.order_id || order._id}`
                // );
              }
              return isActive;
            });

            // Nếu có thay đổi, cập nhật đơn hàng
            if (activeItems.length !== order.items.length) {
              const removedCount = order.items.length - activeItems.length;
              const orderId = order.OrderID || order.order_id || order._id;

              // Nếu không còn sản phẩm nào, xóa đơn hàng
              if (activeItems.length === 0) {
                // Xóa đơn hàng khỏi native collection
                await ordersCollection.deleteOne({ _id: order._id });

                // Xóa đơn hàng khỏi Order model (nếu có)
                try {
                  await Order.findOneAndDelete({ OrderID: orderId });
                } catch (e) {
                  // Ignore if Order model doesn't have this order
                }

                // Đánh dấu đơn hàng để loại bỏ khỏi mảng trả về
                order._shouldDelete = true;

                cleanedOrdersCount++;
                // console.log(
                //   `🗑️ [Orders] Deleted order ${orderId}: all products were inactive`
                // );
              } else {
                // Tính lại subtotal và totalAmount
                const removedItemTotal = order.items
                  .filter((item) => !activeSkus.has(item.sku))
                  .reduce(
                    (sum, item) =>
                      sum + (item.price || 0) * (item.quantity || 0),
                    0
                  );

                const newSubtotal = Math.max(
                  0,
                  (order.subtotal || 0) - removedItemTotal
                );
                const shippingFee = order.shippingFee || 0;
                const shippingDiscount = order.shippingDiscount || 0;
                const discount = order.discount || 0;
                const vatRate = order.vatRate || 0;
                const vatAmount = Math.round((newSubtotal * vatRate) / 100);
                const newTotalAmount = Math.max(
                  0,
                  newSubtotal +
                  shippingFee -
                  shippingDiscount -
                  discount +
                  vatAmount
                );

                // Cập nhật đơn hàng trong native collection
                await ordersCollection.updateOne(
                  { _id: order._id },
                  {
                    $set: {
                      items: activeItems,
                      subtotal: newSubtotal,
                      totalAmount: newTotalAmount,
                      vatAmount: vatAmount,
                      updatedAt: new Date(),
                    },
                  }
                );

                // Cập nhật order object trong memory để trả về đúng
                order.items = activeItems;
                order.subtotal = newSubtotal;
                order.totalAmount = newTotalAmount;
                order.vatAmount = vatAmount;

                cleanedOrdersCount++;
                // console.log(
                //   `✅ [Orders] Cleaned order ${orderId}: removed ${removedCount} inactive products. New total: ${newTotalAmount}`
                // );
              }
            }
          }
        }
      }

      // Loại bỏ các đơn hàng đã bị xóa khỏi mảng trả về
      const validOrders = orders.filter((order) => !order._shouldDelete);

      if (cleanedOrdersCount > 0) {
        const deletedCount = orders.length - validOrders.length;
        if (deletedCount > 0) {
          // console.log(
          //   `🗑️ [Orders] Deleted ${deletedCount} empty orders (all products were inactive)`
          // );
        }
        // console.log(
        //   `✅ [Orders] Cleaned ${cleanedOrdersCount} orders: removed inactive products`
        // );
      }

      res.json({
        success: true,
        data: validOrders,
        count: validOrders.length,
      });
    } else {
      // Get all orders (for admin)
      orders = await ordersCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      // console.log(`✅ Found ${orders.length} total orders`);

      res.json({
        success: true,
        data: orders,
        count: orders.length,
      });
    }
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch orders",
      message: error.message,
    });
  }
});

/**
 * GET order by ID
 */
app.get("/api/orders/:id", checkMongoConnection, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const order = await ordersCollection.findOne({ order_id: orderId });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

/**
 * GET orders by CustomerID (for admin customer detail)
 */
app.get(
  "/api/orders/customer/:customerID",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { customerID } = req.params;

      // console.log(`\n📦 === GET ORDERS BY CUSTOMERID ===`);
      // console.log(`📱 CustomerID: ${customerID}`);

      if (!customerID) {
        return res.status(400).json({
          error: "CustomerID là bắt buộc",
          message: "CustomerID is required",
        });
      }

      // Find orders by CustomerID in MongoDB
      const orders = await ordersCollection
        .find({ CustomerID: customerID })
        .sort({ createdAt: -1 })
        .toArray();

      // console.log(
      //   `✅ Found ${orders.length} orders for customer ${customerID}`
      // );

      res.json({
        success: true,
        data: orders,
        count: orders.length,
      });
    } catch (error) {
      console.error("❌ Error fetching orders:", error);
      res.status(500).json({
        error: "Lỗi server khi lấy danh sách đơn hàng",
        message: error.message,
      });
    }
  }
);

/**
 * GET orders by user ID
 */
app.get("/api/orders/user/:userId", checkMongoConnection, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const orders = await ordersCollection.find({ user_id: userId }).toArray();
    res.json(orders);
  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({ error: "Failed to fetch user orders" });
  }
});

/**
 * PUT update order status
 */
app.put(
  "/api/orders/:orderId/status",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status, reason } = req.body; // Add reason for cancellation

      // console.log(
      //   `\n📦 [Orders] ========== UPDATE ORDER STATUS REQUEST ==========`
      // );
      // console.log(`📦 [Orders] Order ID: ${orderId}`);
      // console.log(`📦 [Orders] Requested status: ${status}`);
      // console.log(
      //   `📦 [Orders] Request body:`,
      //   JSON.stringify(req.body, null, 2)
      // );

      const validStatuses = [
        "pending",
        "confirmed",
        // "processing",        // Đang xử lý - Đã comment
        "shipping",
        "delivered",
        "received", // Đã nhận hàng (user xác nhận hoặc tự động sau 24h)
        "completed",
        "cancelled",
        "processing_return",
        "returning",
        "returned",
      ];

      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
      }

      // Get the current order to update routes
      const currentOrder = await Order.findOne({ OrderID: orderId });
      if (!currentOrder) {
        console.error(`❌ [Orders] Order not found: ${orderId}`);
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // If status is "cancelled", create notification for admin AND update status immediately
      // User can cancel their own orders, admin will be notified
      if (status === "cancelled") {
        try {
          // Check if notification already exists
          const existingNotif = await notificationsCollection.findOne({
            type: "order_cancellation_request",
            orderId: orderId,
            status: "pending",
          });

          if (!existingNotif) {
            await notificationsCollection.insertOne({
              type: "order_cancellation_request",
              orderId: orderId,
              customerId: currentOrder.CustomerID,
              orderTotal: currentOrder.totalAmount,
              reason: reason || "Không có lý do",
              status: "pending", // pending, approved, rejected
              createdAt: new Date(),
              updatedAt: new Date(),
              read: false,
            });
            // console.log(
            //   `📢 [Notifications] Created cancellation request notification for order ${orderId}`
            // );
          }
          //  else {
          //   console.log(
          //     `📢 [Notifications] Cancellation request already exists for order ${orderId}`
          //   );
          // }
        } catch (notifError) {
          console.error(
            "❌ [Notifications] Error creating notification:",
            notifError
          );
          // Continue with normal cancellation if notification fails
        }
        // Continue to update order status to cancelled (don't return early)
      }

      // Initialize routes map if not exists
      let routes = currentOrder.routes;
      if (!routes || typeof routes !== "object") {
        routes = {};
      }

      // Ensure routes is an object (not Map)
      const routesObject =
        routes instanceof Map ? Object.fromEntries(routes) : routes;

      // If order status is "delivered", automatically convert to "completed"
      // Đã comment: Giữ nguyên status "delivered" thay vì tự động chuyển thành "completed"
      let finalStatus = status;
      // if (status === "delivered") {
      //   finalStatus = "completed";
      //   routesObject["completed"] = new Date();
      //   if (!routesObject["delivered"]) {
      //     routesObject["delivered"] = new Date();
      //   }
      // } else {
      //   // Update routes with new status
      //   routesObject[status] = new Date();
      // }

      // Update routes with new status (giữ nguyên status được gửi lên)
      routesObject[status] = new Date();

      // Prepare update data
      const updateData = {
        status: finalStatus,
        routes: routesObject,
        updatedAt: new Date(),
      };

      // If reason is provided (for cancellation), save it
      if (reason && status === "cancelled") {
        updateData.cancelReason = reason;
      }

      // If reason is provided (for return request), save it to returnReason
      if (
        reason &&
        (status === "processing_return" ||
          status === "returning" ||
          status === "returned")
      ) {
        updateData.returnReason = reason;
      }

      // Log the update attempt
      // console.log(
      //   `📦 [Orders] Updating order ${orderId} status from "${currentOrder.status}" to "${finalStatus}"`
      // );
      // if (reason && status === "cancelled") {
      //   console.log(`📦 [Orders] Cancel reason: ${reason}`);
      // }

      let order;
      try {
        order = await Order.findOneAndUpdate(
          { OrderID: orderId },
          { $set: updateData },
          { new: true, runValidators: true }
        );
      } catch (validationError) {
        console.error(
          `❌ [Orders] Validation error when updating order ${orderId}:`,
          validationError
        );
        console.error(`❌ [Orders] Validation error details:`, {
          message: validationError.message,
          name: validationError.name,
          errors: validationError.errors,
        });
        return res.status(400).json({
          success: false,
          message: `Validation error: ${validationError.message}`,
          details: validationError.errors || {},
        });
      }

      // Verify the update was successful
      if (!order) {
        console.error(
          `❌ [Orders] Failed to update order ${orderId} - order not found after update`
        );
        return res.status(500).json({
          success: false,
          message: "Failed to update order status - order not found",
        });
      }

      // Double-check the status was actually updated
      const verifiedOrder = await Order.findOne({ OrderID: orderId });
      if (!verifiedOrder) {
        console.error(
          `❌ [Orders] Order ${orderId} not found after verification query`
        );
        return res.status(500).json({
          success: false,
          message: "Failed to verify order update",
        });
      }

      // Log success with verified status
      // console.log(`✅ [Orders] Successfully updated order ${orderId}`);
      // console.log(
      //   `✅ [Orders] Verified status in DB: "${verifiedOrder.status}"`
      // );
      // console.log(`✅ [Orders] Order object status: "${order.status}"`);
      // if (verifiedOrder.cancelReason) {
      //   console.log(
      //     `✅ [Orders] Cancel reason saved: ${verifiedOrder.cancelReason}`
      //   );
      // }

      // Use verified order for response to ensure we return the actual database state
      const responseOrder = verifiedOrder;

      // ========== TỰ ĐỘNG CHUYỂN confirmed → shipping SAU 30 GIÂY (test) ==========
      // Nếu status vừa được update thành "confirmed", tự động schedule chuyển sang "shipping" sau 30 giây (để test)
      if (status === "confirmed" && verifiedOrder.status === "confirmed") {
        // Test: 30 giây
        const delayMs = 30 * 1000; // 30 giây
        const delaySeconds = 30;
        const startTime = new Date();
        const targetTime = new Date(startTime.getTime() + delayMs);

        // console.log(
        //   `⏰ [Orders] Scheduling automatic status change: confirmed → shipping after ${delayMinutes} minutes for order ${orderId}`
        // );
        // console.log(`   📅 Start time: ${startTime.toLocaleString("vi-VN")}`);
        // console.log(`   🎯 Target time: ${targetTime.toLocaleString("vi-VN")}`);

        // Countdown timer - log every 10 seconds (vì delay chỉ 30 giây)
        let countdownInterval = setInterval(() => {
          const now = new Date();
          const remaining = targetTime.getTime() - now.getTime();

          if (remaining <= 0) {
            clearInterval(countdownInterval);
            return;
          }

          const remainingSeconds = Math.floor(remaining / 1000);

          // console.log(
          //   `   ⏳ [Countdown] Order ${orderId}: Còn ${remainingSeconds} giây để chuyển sang shipping...`
          // );
        }, 10 * 1000); // Log every 10 seconds

        setTimeout(async () => {
          clearInterval(countdownInterval); // Clear countdown when timeout fires
          try {
            // Kiểm tra lại order để đảm bảo vẫn còn status "confirmed" (chưa bị thay đổi)
            const currentOrder = await Order.findOne({ OrderID: orderId });
            if (currentOrder && currentOrder.status === "confirmed") {
              // console.log(
              //   `🚚 [Orders] Auto-updating order ${orderId} from confirmed → shipping`
              // );

              // Update routes
              let routes = currentOrder.routes || {};
              const routesObject =
                routes instanceof Map ? Object.fromEntries(routes) : routes;
              routesObject["shipping"] = new Date();

              // Update status to shipping
              await Order.findOneAndUpdate(
                { OrderID: orderId },
                {
                  $set: {
                    status: "shipping",
                    routes: routesObject,
                    updatedAt: new Date(),
                  },
                },
                { new: true, runValidators: true }
              );

              const updateTime = new Date();
              // console.log(
              //   `✅ [Orders] Successfully auto-updated order ${orderId} to shipping status at ${updateTime.toLocaleString(
              //     "vi-VN"
              //   )}`
              // );
              // console.log(
              //   `   ⏱️ Total time elapsed: ${Math.round(
              //     (updateTime.getTime() - startTime.getTime()) / 1000
              //   )} seconds`
              // );
            }
            // else {
            //   console.log(
            //     `⚠️ [Orders] Order ${orderId} status changed before auto-update, skipping shipping transition`
            //   );
            // }
          } catch (error) {
            console.error(
              `❌ [Orders] Error auto-updating order ${orderId} to shipping:`,
              error
            );
          }
        }, delayMs); // Sử dụng delayMs đã tính từ delayMinutes
      }

      // ========== TỰ ĐỘNG CHUYỂN delivered → received SAU 24 GIỜ ==========
      // Nếu status vừa được update thành "delivered", tự động schedule chuyển sang "received" sau 24 giờ
      if (status === "delivered" && verifiedOrder.status === "delivered") {
        // Production: 24 giờ (24 * 60 = 1440 phút)
        const delayMinutes = 24 * 60; // 24 giờ = 1440 phút
        const delayMs = delayMinutes * 60 * 1000;
        const startTime = new Date();
        const targetTime = new Date(startTime.getTime() + delayMs);

        // console.log(
        //   `⏰ [Orders] Scheduling automatic status change: delivered → received after ${delayMinutes} minutes for order ${orderId}`
        // );
        // console.log(`   📅 Start time: ${startTime.toLocaleString("vi-VN")}`);
        // console.log(`   🎯 Target time: ${targetTime.toLocaleString("vi-VN")}`);

        // Countdown timer - log every 30 seconds
        let countdownInterval = setInterval(() => {
          const now = new Date();
          const remaining = targetTime.getTime() - now.getTime();

          if (remaining <= 0) {
            clearInterval(countdownInterval);
            return;
          }

          const remainingMinutes = Math.floor(remaining / 60000);
          const remainingSeconds = Math.floor((remaining % 60000) / 1000);

          //   console.log(
          //     `   ⏳ [Countdown] Order ${orderId}: Còn ${remainingMinutes} phút ${remainingSeconds} giây để chuyển sang received...`
          //   );
        }, 30 * 1000); // Log every 30 seconds

        setTimeout(async () => {
          clearInterval(countdownInterval); // Clear countdown when timeout fires
          try {
            // Kiểm tra lại order để đảm bảo vẫn còn status "delivered" (chưa bị thay đổi bởi user)
            const currentOrder = await Order.findOne({ OrderID: orderId });
            if (currentOrder && currentOrder.status === "delivered") {
              // console.log(
              //   `📦 [Orders] Auto-updating order ${orderId} from delivered → received`
              // );

              // Update routes
              let routes = currentOrder.routes || {};
              const routesObject =
                routes instanceof Map ? Object.fromEntries(routes) : routes;
              routesObject["received"] = new Date();

              // Update status to received
              await Order.findOneAndUpdate(
                { OrderID: orderId },
                {
                  $set: {
                    status: "received",
                    routes: routesObject,
                    updatedAt: new Date(),
                  },
                },
                { new: true, runValidators: true }
              );

              const updateTime = new Date();
              // console.log(
              //   `✅ [Orders] Successfully auto-updated order ${orderId} to received status at ${updateTime.toLocaleString(
              //     "vi-VN"
              //   )}`
              // );
              // console.log(
              //   `   ⏱️ Total time elapsed: ${Math.round(
              //     (updateTime.getTime() - startTime.getTime()) / 1000
              //   )} seconds`
              // );
            }
            // else {
            //   console.log(
            //     `⚠️ [Orders] Order ${orderId} status changed before auto-update, skipping received transition`
            //   );
            // }
          } catch (error) {
            console.error(
              `❌ [Orders] Error auto-updating order ${orderId} to received:`,
              error
            );
          }
        }, delayMs); // Sử dụng delayMs đã tính từ delayMinutes
      }

      // ========== TỰ ĐỘNG CHUYỂN received → completed SAU 24 GIỜ ==========
      // Nếu status vừa được update thành "received", tự động schedule chuyển sang "completed" sau 24 giờ
      if (status === "received" && verifiedOrder.status === "received") {
        // Production: 24 giờ (24 * 60 = 1440 phút)
        const delayMinutes = 24 * 60; // 24 giờ = 1440 phút
        const delayMs = delayMinutes * 60 * 1000;
        const startTime = new Date();
        const targetTime = new Date(startTime.getTime() + delayMs);

        // console.log(
        //   `⏰ [Orders] Scheduling automatic status change: received → completed after ${delayMinutes} minutes for order ${orderId}`
        // );
        // console.log(`   📅 Start time: ${startTime.toLocaleString("vi-VN")}`);
        // console.log(`   🎯 Target time: ${targetTime.toLocaleString("vi-VN")}`);

        // Countdown timer - log every 30 seconds
        let countdownInterval = setInterval(() => {
          const now = new Date();
          const remaining = targetTime.getTime() - now.getTime();

          if (remaining <= 0) {
            clearInterval(countdownInterval);
            return;
          }

          const remainingMinutes = Math.floor(remaining / 60000);
          const remainingSeconds = Math.floor((remaining % 60000) / 1000);

          // console.log(
          //   `   ⏳ [Countdown] Order ${orderId}: Còn ${remainingMinutes} phút ${remainingSeconds} giây để chuyển sang completed...`
          // );
        }, 30 * 1000); // Log every 30 seconds

        setTimeout(async () => {
          clearInterval(countdownInterval); // Clear countdown when timeout fires
          try {
            // Kiểm tra lại order để đảm bảo vẫn còn status "received" (chưa bị thay đổi bởi user review hoặc cancel return)
            const currentOrder = await Order.findOne({ OrderID: orderId });
            if (currentOrder && currentOrder.status === "received") {
              // console.log(
              //   `✅ [Orders] Auto-updating order ${orderId} from received → completed`
              // );

              // Update routes
              let routes = currentOrder.routes || {};
              const routesObject =
                routes instanceof Map ? Object.fromEntries(routes) : routes;
              routesObject["completed"] = new Date();

              // Update status to completed
              await Order.findOneAndUpdate(
                { OrderID: orderId },
                {
                  $set: {
                    status: "completed",
                    routes: routesObject,
                    updatedAt: new Date(),
                  },
                },
                { new: true, runValidators: true }
              );

              const updateTime = new Date();
              // console.log(
              //   `✅ [Orders] Successfully auto-updated order ${orderId} to completed status at ${updateTime.toLocaleString(
              //     "vi-VN"
              //   )}`
              // );
              // console.log(
              //   `   ⏱️ Total time elapsed: ${Math.round(
              //     (updateTime.getTime() - startTime.getTime()) / 1000
              //   )} seconds`
              // );
            } else {
              console.log(
                `⚠️ [Orders] Order ${orderId} status changed before auto-update, skipping completed transition`
              );
            }
          } catch (error) {
            console.error(
              `❌ [Orders] Error auto-updating order ${orderId} to completed:`,
              error
            );
          }
        }, delayMs); // Sử dụng delayMs đã tính từ delayMinutes
      }

      // ========== XỬ LÝ TỒN KHO SẢN PHẨM ==========
      const previousStatus = currentOrder.status;

      // LƯU Ý: Stock đã được giảm ngay khi tạo order (status = pending)
      // Không cần giảm lại khi chuyển sang confirmed/processing

      // Tăng lại tồn kho khi đơn hàng bị hủy (cancelled)
      // Tăng lại nếu đơn hàng đã được đặt (đã giảm stock khi tạo order)
      if (finalStatus === "cancelled" && previousStatus === "pending") {
        try {
          // console.log(
          //   `📦 [Stock] Restoring stock for cancelled order ${orderId} (previous status: ${previousStatus})`
          // );

          // Nhóm items theo SKU để tính tổng quantity (bao gồm cả purchased và gifted items)
          const stockRestoreMap = new Map();

          for (const item of responseOrder.items) {
            if (item.sku && item.quantity && item.quantity > 0) {
              const currentTotal = stockRestoreMap.get(item.sku) || 0;
              stockRestoreMap.set(item.sku, currentTotal + item.quantity);
            }
          }

          // Tăng lại stock cho từng SKU
          for (const [sku, totalQuantity] of stockRestoreMap.entries()) {
            const updateResult = await Product.findOneAndUpdate(
              { sku: sku },
              { $inc: { stock: totalQuantity } }, // Tăng lại stock
              { new: true }
            );

            if (updateResult) {
              // console.log(
              //   `✅ [Stock] Restored stock for SKU ${sku} (cancelled): ${
              //     updateResult.stock - totalQuantity
              //   } -> ${updateResult.stock} (total quantity: ${totalQuantity})`
              // );
            } else {
              console.warn(`⚠️ [Stock] Product not found for SKU: ${sku}`);
            }
          }
        } catch (stockError) {
          console.error(
            `❌ [Stock] Error restoring stock for cancelled order ${orderId}:`,
            stockError
          );
          // Don't fail the order update if stock update fails
        }
      }

      // Tăng lại tồn kho khi đơn hàng bị trả hàng (returned)
      // Tăng lại khi trả hàng được chấp nhận (đã giảm stock khi tạo order)
      if (
        finalStatus === "returned" &&
        (previousStatus === "pending" ||
          previousStatus === "confirmed" ||
          previousStatus === "processing" ||
          previousStatus === "shipping" ||
          previousStatus === "delivered" ||
          previousStatus === "completed" ||
          previousStatus === "processing_return" ||
          previousStatus === "returning")
      ) {
        try {
          // console.log(
          //   `📦 [Stock - SERVER.JS] Restoring stock for returned order ${orderId} (previous status: ${previousStatus})`
          // );
          // console.log(
          //   `📦 [Stock - SERVER.JS] Order items count: ${responseOrder.items.length}`
          // );

          // Nhóm items theo SKU để tính tổng quantity (bao gồm cả purchased và gifted items)
          const stockRestoreMap = new Map();

          for (const item of responseOrder.items) {
            // console.log(
            //   `📦 [Stock - SERVER.JS] Processing item: SKU=${item.sku}, quantity=${item.quantity}, itemType=${item.itemType}`
            // );
            if (item.sku && item.quantity && item.quantity > 0) {
              const currentTotal = stockRestoreMap.get(item.sku) || 0;
              stockRestoreMap.set(item.sku, currentTotal + item.quantity);
              // console.log(
              //   `📦 [Stock - SERVER.JS] Updated stock restore map for SKU ${
              //     item.sku
              //   }: ${currentTotal} -> ${currentTotal + item.quantity}`
              // );
            } else {
              console.warn(
                `⚠️ [Stock - SERVER.JS] Skipping item with invalid data: SKU=${item.sku}, quantity=${item.quantity}`
              );
            }
          }

          // console.log(
          //   `📦 [Stock - SERVER.JS] Stock restore map:`,
          //   Array.from(stockRestoreMap.entries())
          // );

          // Tăng lại stock cho từng SKU
          for (const [sku, totalQuantity] of stockRestoreMap.entries()) {
            // console.log(
            //   `📦 [Stock - SERVER.JS] Attempting to restore stock for SKU ${sku}: quantity=${totalQuantity}`
            // );

            // Kiểm tra product có tồn tại không
            const productBefore = await Product.findOne({ sku: sku });
            if (!productBefore) {
              console.error(
                `❌ [Stock - SERVER.JS] Product not found for SKU: ${sku}`
              );
              continue;
            }

            // console.log(
            //   `📦 [Stock - SERVER.JS] Product found: SKU=${sku}, currentStock=${productBefore.stock}`
            // );

            const updateResult = await Product.findOneAndUpdate(
              { sku: sku },
              { $inc: { stock: totalQuantity } }, // Tăng lại stock
              { new: true }
            );

            if (updateResult) {
              // console.log(
              //   `✅ [Stock - SERVER.JS] Restored stock for SKU ${sku} (returned): ${
              //     updateResult.stock - totalQuantity
              //   } -> ${updateResult.stock} (total quantity: ${totalQuantity})`
              // );
            } else {
              console.error(
                `❌ [Stock - SERVER.JS] Failed to update stock for SKU: ${sku}`
              );
            }
          }
        } catch (stockError) {
          console.error(
            `❌ [Stock] Error restoring stock for returned order ${orderId}:`,
            stockError
          );
          // Don't fail the order update if stock update fails
        }
      }

      // Create notification for user based on order status change
      try {
        await createOrderStatusNotification(
          responseOrder.CustomerID,
          orderId,
          finalStatus,
          responseOrder.totalAmount
        );
      } catch (notifError) {
        console.error(
          "❌ Error creating order status notification:",
          notifError
        );
        // Don't fail the request if notification creation fails
      }

      // Create admin notification for return requests
      if (
        finalStatus === "processing_return" ||
        finalStatus === "returning" ||
        finalStatus === "returned"
      ) {
        try {
          const returnMessages = {
            processing_return: {
              title: "Yêu cầu trả hàng",
              message: `Khách hàng ${responseOrder.CustomerID} yêu cầu trả hàng cho đơn hàng #${orderId}`,
            },
            returning: {
              title: "Đơn hàng đang được trả",
              message: `Đơn hàng #${orderId} của khách hàng ${responseOrder.CustomerID} đang trong quá trình trả hàng`,
            },
            returned: {
              title: "Đơn hàng đã được trả",
              message: `Đơn hàng #${orderId} của khách hàng ${responseOrder.CustomerID} đã được trả thành công`,
            },
          };

          const message = returnMessages[finalStatus];
          await createAdminNotification(
            "return_request",
            orderId,
            responseOrder.CustomerID,
            responseOrder.totalAmount,
            message
          );
        } catch (adminNotifError) {
          console.error(
            "❌ Error creating admin notification for return request:",
            adminNotifError
          );
          // Don't fail the request if notification creation fails
        }
      }

      // If order is completed, update customer stats
      // CHỈ tính TotalSpent khi order có status = "completed" (KHÔNG tính "delivered")
      // if (finalStatus === "completed" || status === "delivered") {
      if (finalStatus === "completed") {
        try {
          // Update customer TotalSpent and CustomerTiering
          const {
            updateUserTotalSpentAndTieringAsync,
          } = require("./services/totalspent-tiering.service");
          await updateUserTotalSpentAndTieringAsync(
            User,
            Order,
            responseOrder.CustomerID
          );

          // Increment purchase_count for all products in order (1 lượt per order, not per quantity)
          try {
            // Group items by SKU to ensure each product only gets +1 per order
            const uniqueSKUs = new Set();
            for (const item of responseOrder.items) {
              if (item.sku && !uniqueSKUs.has(item.sku)) {
                uniqueSKUs.add(item.sku);
                await Product.findOneAndUpdate(
                  { sku: item.sku },
                  { $inc: { purchase_count: 1 } },
                  { new: true }
                );
              }
            }
          } catch (productError) {
            console.error(
              "Error updating product purchase_count:",
              productError
            );
          }
        } catch (error) {
          console.error("Error updating customer stats:", error);
        }
      }

      res.json({
        success: true,
        message: "Order status updated successfully",
        data: responseOrder, // Use verified order to ensure we return the actual database state
      });
    } catch (error) {
      console.error("❌ [Orders] Error updating order status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update order status",
        error: error.message,
      });
    }
  }
);

/**
 * PUT update order
 */
// ========== DELETE ORDER ==========
// DELETE /api/orders/:orderId
app.delete("/api/orders/:orderId", checkMongoConnection, async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log(`🗑️ [Orders] Attempting to delete order with ID: ${orderId}`);

    // Try to find order by OrderID (supports both with and without ORD prefix)
    // First try exact match
    let order = await Order.findOneAndDelete({ OrderID: orderId });

    // If not found and orderId doesn't start with "ORD", try with "ORD" prefix
    if (!order && !orderId.startsWith("ORD")) {
      console.log(
        `🗑️ [Orders] Order not found with ${orderId}, trying with ORD prefix...`
      );
      order = await Order.findOneAndDelete({ OrderID: `ORD${orderId}` });
    }

    // If still not found and orderId starts with "ORD", try without prefix
    if (!order && orderId.startsWith("ORD")) {
      const orderIdWithoutPrefix = orderId.substring(3); // Remove "ORD" prefix
      console.log(
        `🗑️ [Orders] Order not found with ${orderId}, trying without ORD prefix: ${orderIdWithoutPrefix}...`
      );
      order = await Order.findOneAndDelete({ OrderID: orderIdWithoutPrefix });
    }

    if (!order) {
      console.log(`❌ [Orders] Order not found: ${orderId}`);
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log(`✅ [Orders] Order deleted successfully: ${order.OrderID}`);

    res.json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (error) {
    console.error("❌ [Orders] Error deleting order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete order",
      error: error.message,
    });
  }
});

app.put("/api/orders/:orderId", checkMongoConnection, async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderData = req.body;

    console.log(`📦 [Orders] Updating order ${orderId}`);
    console.log(
      "📦 [Orders] Request body:",
      JSON.stringify(orderData, null, 2)
    );

    // Validate required fields
    if (
      !orderData.CustomerID ||
      !orderData.shippingInfo ||
      !orderData.items ||
      orderData.items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: CustomerID, shippingInfo, or items",
      });
    }

    // Validate shipping info
    if (
      !orderData.shippingInfo.fullName ||
      !orderData.shippingInfo.phone ||
      !orderData.shippingInfo.address ||
      !orderData.shippingInfo.address.city ||
      !orderData.shippingInfo.address.district ||
      !orderData.shippingInfo.address.ward ||
      !orderData.shippingInfo.address.detail
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required shipping information",
      });
    }

    // Check if order exists
    const existingOrder = await Order.findOne({ OrderID: orderId });
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update routes if status changed
    const routes = existingOrder.routes || {};
    const routesObject =
      routes instanceof Map ? Object.fromEntries(routes) : routes;

    if (orderData.status && orderData.status !== existingOrder.status) {
      routesObject[orderData.status] = new Date();
    }

    // Prepare update data
    const updateData = {
      CustomerID: orderData.CustomerID,
      shippingInfo: {
        fullName: orderData.shippingInfo.fullName,
        phone: orderData.shippingInfo.phone,
        email: orderData.shippingInfo.email || "",
        address: {
          city: orderData.shippingInfo.address.city,
          district: orderData.shippingInfo.address.district,
          ward: orderData.shippingInfo.address.ward,
          detail: orderData.shippingInfo.address.detail,
        },
        deliveryMethod: orderData.shippingInfo.deliveryMethod || "standard",
        warehouseAddress: orderData.shippingInfo.warehouseAddress || "",
        notes: orderData.shippingInfo.notes || "",
      },
      items: orderData.items.map((item) => {
        let imageValue = "";
        if (item.image) {
          if (Array.isArray(item.image)) {
            imageValue = item.image[0] || "";
          } else {
            imageValue = String(item.image);
          }
        }
        return {
          sku: item.sku || "",
          productName: item.productName || "",
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          image: imageValue,
          unit: item.unit || "",
          category: item.category || "",
          subcategory: item.subcategory || "",
        };
      }),
      paymentMethod: orderData.paymentMethod || "cod",
      subtotal: Number(orderData.subtotal) || 0,
      shippingFee: Number(orderData.shippingFee) || 0,
      shippingDiscount: Number(orderData.shippingDiscount) || 0,
      discount: Number(orderData.discount) || 0,
      vatRate: Number(orderData.vatRate) || 0,
      vatAmount: Number(orderData.vatAmount) || 0,
      totalAmount: Number(orderData.totalAmount) || 0,
      code: orderData.code || "",
      promotionName: orderData.promotionName || "",
      wantInvoice: orderData.wantInvoice || false,
      invoiceInfo: orderData.invoiceInfo || {},
      consultantCode: orderData.consultantCode || "",
      routes: routesObject,
      updatedAt: new Date(),
    };

    // Only update status if provided
    if (orderData.status) {
      updateData.status = orderData.status;
    }

    // Update order
    const updatedOrder = await Order.findOneAndUpdate(
      { OrderID: orderId },
      updateData,
      { new: true }
    );

    console.log(`✅ [Orders] Updated order ${orderId} successfully`);

    res.json({
      success: true,
      message: "Order updated successfully",
      data: updatedOrder,
    });
  } catch (error) {
    console.error("❌ [Orders] Error updating order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update order",
      error: error.message,
    });
  }
});

// ============================================================================
// PRODUCTS ENDPOINTS
// ============================================================================

/**
 * GET all products with pagination support
 * Query params:
 *   - page: Page number (default: 1)
 *   - limit: Items per page (default: 20, max: 100)
 *   - group: Filter by group (optional)
 */
app.get("/api/products", checkMongoConnection, async (req, res) => {
  try {
    const {
      group,
      page = 1,
      limit = 20,
      category,
      subcategory,
      minPrice,
      maxPrice,
      sort,
      search,
      promotion,
    } = req.query;

    // Parse and validate pagination parameters
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Build query
    let query = { status: "Active" };

    // Filter by group
    if (group && group !== "all") {
      query.groups = group;
    }

    // Filter by Category
    if (category) {
      query.Category = category;
    }

    // Filter by Subcategory
    if (subcategory) {
      query.Subcategory = subcategory;
    }

    // Filter by Price Range
    if (minPrice || maxPrice) {
      query.Price = {};
      if (minPrice) query.Price.$gte = parseInt(minPrice);
      if (maxPrice) query.Price.$lte = parseInt(maxPrice);
    }

    // Filter by Search (ProductName)
    if (search) {
      // Remove accents for better search (optional, depends on requirement)
      // For now, simple regex search
      query.ProductName = { $regex: search, $options: "i" };
    }

    // Filter by Promotion
    if (promotion === "true") {
      // Check for hasPromotion flag or promotionType
      query.$or = [
        { hasPromotion: true },
        { promotionType: { $exists: true, $ne: null } },
      ];
    }

    // Build Sort Object
    let sortOptions = {};
    if (sort) {
      switch (sort) {
        case "newest":
          sortOptions.PostDate = -1; // Descending
          break;
        case "bestseller":
          sortOptions.PurchaseCount = -1; // Descending
          break;
        case "price-asc":
          sortOptions.Price = 1; // Ascending
          break;
        case "price-desc":
          sortOptions.Price = -1; // Descending
          break;
        case "name-asc":
          sortOptions.ProductName = 1; // Ascending
          break;
        default:
          sortOptions.PostDate = -1; // Default to newest
      }
    } else {
      sortOptions.PostDate = -1; // Default sort
    }

    // Get total count for pagination (with filters applied)
    const totalCount = await productsCollection.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limitNum);

    // Fetch products with pagination, filtering, and sorting
    const products = await productsCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    // Import rating service to calculate reviewCount (rating is already synced in products collection)
    const { calculateProductRating } = require("./services/rating.service");

    // Add reviewCount for each product from reviews collection (rating is already in products collection)
    const productsWithRatings = await Promise.all(
      products.map(async (product) => {
        try {
          const { reviewCount } = await calculateProductRating(product.sku);
          return {
            ...product,
            rating: product.rating || 0, // Use rating from products collection (already synced)
            reviewCount: reviewCount, // Add reviewCount from reviews
          };
        } catch (error) {
          // If error, use existing rating or default to 0
          return {
            ...product,
            rating: product.rating || 0,
            reviewCount: 0,
          };
        }
      })
    );

    res.json({
      success: true,
      data: productsWithRatings,
      count: productsWithRatings.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch products",
      message: error.message,
    });
  }
});

// ============================================================================
// PRODUCT METADATA ENDPOINTS - Must be placed BEFORE /:id route to avoid conflicts
// ============================================================================

/**
 * GET /api/products/metadata/categories - Lấy danh sách categories
 */
app.get(
  "/api/products/metadata/categories",
  checkMongoConnection,
  async (req, res) => {
    try {
      const categories = await productsCollection.distinct("category", {
        status: "Active",
      });
      const filteredCategories = categories.filter(
        (c) => c && typeof c === "string" && c.trim() !== ""
      );
      res.json({
        success: true,
        data: filteredCategories,
        count: filteredCategories.length,
      });
    } catch (error) {
      // console.error(" [Products API] Error fetching categories:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy danh sách categories",
        error: error.message,
      });
    }
  }
);

/**
 * GET /api/products/metadata/subcategories - Lấy danh sách subcategories
 */
app.get(
  "/api/products/metadata/subcategories",
  checkMongoConnection,
  async (req, res) => {
    try {
      const subcategories = await productsCollection.distinct("subcategory", {
        status: "Active",
      });
      const filteredSubcategories = subcategories.filter(
        (s) => s && typeof s === "string" && s.trim() !== ""
      );
      res.json({
        success: true,
        data: filteredSubcategories,
        count: filteredSubcategories.length,
      });
    } catch (error) {
      // console.error(" [Products API] Error fetching subcategories:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy danh sách subcategories",
        error: error.message,
      });
    }
  }
);

/**
 * GET /api/products/metadata/brands - Lấy danh sách brands
 */
app.get(
  "/api/products/metadata/brands",
  checkMongoConnection,
  async (req, res) => {
    try {
      const brands = await productsCollection.distinct("brand", {
        status: "Active",
      });
      const filteredBrands = brands.filter(
        (b) => b && typeof b === "string" && b.trim() !== ""
      );
      res.json({
        success: true,
        data: filteredBrands,
        count: filteredBrands.length,
      });
    } catch (error) {
      // console.error(" [Products API] Error fetching brands:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy danh sách brands",
        error: error.message,
      });
    }
  }
);

/**
 * GET /api/products/metadata/products - Lấy danh sách products (SKU và tên)
 */
app.get(
  "/api/products/metadata/products",
  checkMongoConnection,
  async (req, res) => {
    try {
      const products = await productsCollection
        .find({ status: "Active" })
        .project({ sku: 1, product_name: 1, productName: 1 })
        .limit(1000)
        .toArray();

      const productList = products.map((p) => ({
        sku: p.sku,
        name: p.product_name || p.productName || p.sku,
      }));

      res.json({
        success: true,
        data: productList,
        count: productList.length,
      });
    } catch (error) {
      console.error(" API] Error fetching products:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy danh sách products",
        error: error.message,
      });
    }
  }
);

// ============================================================================
// PRODUCT GROUPS ROUTES - Must be placed BEFORE /:id route to avoid conflicts
// ============================================================================

/**
 * GET /api/products/metadata/groups - Lấy danh sách tất cả product groups
 */
app.get(
  "/api/products/metadata/groups",
  checkMongoConnection,
  async (req, res) => {
    try {
      // Get all unique group names from products
      const products = await productsCollection
        .find({ status: "Active" })
        .toArray();
      const groupsSet = new Set();

      products.forEach((product) => {
        if (product.groups && Array.isArray(product.groups)) {
          product.groups.forEach((group) => {
            if (group && group.trim() !== "") {
              groupsSet.add(group.trim());
            }
          });
        }
      });

      const groups = Array.from(groupsSet).sort();

      res.json({
        success: true,
        data: groups,
        count: groups.length,
      });
    } catch (error) {
      // console.error("❌ [Products API] Error fetching groups:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy danh sách groups",
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/products/groups - Tạo nhóm và gán cho nhiều sản phẩm
 */
app.post("/api/products/groups", checkMongoConnection, async (req, res) => {
  try {
    const { groupName, skus } = req.body;

    if (!groupName || !groupName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tên nhóm không được để trống",
      });
    }

    if (!skus || !Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Danh sách SKU không được để trống",
      });
    }

    const trimmedGroupName = groupName.trim();

    // console.log(
    //   `📦 [Products API] Creating group "${trimmedGroupName}" for ${skus.length} products`
    // );

    // Update all products to add this group
    const updateResult = await productsCollection.updateMany(
      { sku: { $in: skus } },
      { $addToSet: { groups: trimmedGroupName } } // $addToSet ensures no duplicates
    );

    // console.log(
    //   `✅ [Products API] Added group "${trimmedGroupName}" to ${updateResult.modifiedCount} products`
    // );

    // Get updated products
    const updatedProducts = await productsCollection
      .find({ sku: { $in: skus } })
      .toArray();

    res.json({
      success: true,
      message: `Đã tạo nhóm "${trimmedGroupName}" và gán cho ${updateResult.modifiedCount} sản phẩm`,
      data: {
        groupName: trimmedGroupName,
        productCount: updateResult.modifiedCount,
        products: updatedProducts,
      },
    });
  } catch (error) {
    console.error("❌ [Products API] Error creating group:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo nhóm sản phẩm",
      error: error.message,
    });
  }
});

/**
 * PUT /api/products/groups/product/:sku - Thêm/xóa groups từ một sản phẩm
 */
app.put(
  "/api/products/groups/product/:sku",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { sku } = req.params;
      const { action, groupName } = req.body; // action: 'add' or 'remove'

      if (!action || !["add", "remove"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "Action phải là 'add' hoặc 'remove'",
        });
      }

      if (!groupName || !groupName.trim()) {
        return res.status(400).json({
          success: false,
          message: "Tên nhóm không được để trống",
        });
      }

      const trimmedGroupName = groupName.trim();
      const product = await productsCollection.findOne({ sku });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy sản phẩm",
        });
      }

      let updateOperator;
      if (action === "add") {
        updateOperator = { $addToSet: { groups: trimmedGroupName } };
        // console.log(
        //   `📦 [Products API] Adding group "${trimmedGroupName}" to product ${sku}`
        // );
      } else {
        updateOperator = { $pull: { groups: trimmedGroupName } };
        // console.log(
        //   `📦 [Products API] Removing group "${trimmedGroupName}" from product ${sku}`
        // );
      }

      const result = await productsCollection.findOneAndUpdate(
        { sku },
        updateOperator,
        { returnDocument: "after" }
      );

      if (!result.value) {
        return res.status(404).json({
          success: false,
          message: "Không thể cập nhật sản phẩm",
        });
      }

      // console.log(
      //   `✅ [Products API] Product ${sku} groups updated:`,
      //   result.value.groups
      // );

      res.json({
        success: true,
        message:
          action === "add"
            ? `Đã thêm sản phẩm vào nhóm "${trimmedGroupName}"`
            : `Đã xóa sản phẩm khỏi nhóm "${trimmedGroupName}"`,
        data: result.value,
      });
    } catch (error) {
      console.error("❌ [Products API] Error updating product groups:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi cập nhật nhóm sản phẩm",
        error: error.message,
      });
    }
  }
);

/**
 * DELETE /api/products/groups/:groupName - Xóa nhóm khỏi tất cả sản phẩm
 */
app.delete(
  "/api/products/groups/:groupName",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { groupName } = req.params;

      // console.log(
      //   `📦 [Products API] Removing group "${groupName}" from all products`
      // );

      // Remove group from all products
      const updateResult = await productsCollection.updateMany(
        { groups: groupName },
        { $pull: { groups: groupName } }
      );

      // console.log(
      //   `✅ [Products API] Removed group "${groupName}" from ${updateResult.modifiedCount} products`
      // );

      res.json({
        success: true,
        message: `Đã xóa nhóm "${groupName}" khỏi ${updateResult.modifiedCount} sản phẩm`,
        data: {
          groupName,
          productCount: updateResult.modifiedCount,
        },
      });
    } catch (error) {
      console.error("❌ [Products API] Error deleting group:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi xóa nhóm sản phẩm",
        error: error.message,
      });
    }
  }
);

/**
 * GET product by ID or SKU
 */
app.get("/api/products/:id", checkMongoConnection, async (req, res) => {
  try {
    const id = req.params.id;
    // console.log(`[Products API] Fetching product with ID/SKU: ${id}`);

    // Strategy 1: Try to find by SKU first (most common case)
    let product = await productsCollection.findOne({ sku: id });

    if (product) {
      // console.log(
      //   `[Products API] Found product by SKU: ${
      //     product.product_name || product.productName
      //   }`
      // );
      return res.json({
        success: true,
        data: product,
      });
    }

    // Strategy 2: Try to find by _id as string (direct match)
    product = await productsCollection.findOne({ _id: id });

    if (product) {
      // console.log(
      //   `[Products API] Found product by _id (string): ${
      //     product.product_name || product.productName
      //   }`
      // );
      return res.json({
        success: true,
        data: product,
      });
    }

    // Strategy 3: Try to find by _id as ObjectId
    try {
      // Check if it looks like a valid ObjectId format (24 hex characters)
      if (/^[0-9a-fA-F]{24}$/.test(id)) {
        const objectId = new ObjectId(id);
        product = await productsCollection.findOne({ _id: objectId });

        if (product) {
          // console.log(
          //   `[Products API] Found product by _id (ObjectId): ${
          //     product.product_name || product.productName
          //   }`
          // );
          return res.json({
            success: true,
            data: product,
          });
        }
      }
    } catch (e) {
      // Invalid ObjectId format, continue
      // console.log(`[Products API] Invalid ObjectId format: ${id}`);
    }

    // Strategy 4: Try to find by product_name (fallback)
    product = await productsCollection.findOne({
      $or: [{ product_name: id }, { productName: id }],
    });

    if (product) {
      // console.log(
      //   `[Products API] Found product by name: ${
      //     product.product_name || product.productName
      //   }`
      // );
      return res.json({
        success: true,
        data: product,
      });
    }

    // Not found
    // console.log(`[Products API] Product not found: ${id}`);
    return res.status(404).json({
      success: false,
      error: "Product not found",
      message: `No product found with ID/SKU: ${id}`,
    });
  } catch (error) {
    console.error("[Products API] Error fetching product:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch product",
      message: error.message,
    });
  }
});

/**
 * GET products by category
 */
app.get(
  "/api/products/category/:category",
  checkMongoConnection,
  async (req, res) => {
    try {
      const category = req.params.category;
      const products = await productsCollection
        .find({
          category: category,
          status: "Active",
        })
        .toArray();

      res.json({
        success: true,
        data: products,
        count: products.length,
      });
    } catch (error) {
      console.error("Error fetching products by category:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch products by category",
        message: error.message,
      });
    }
  }
);

/**
 * GET products by category and subcategory
 */
app.get(
  "/api/products/category/:category/:subcategory",
  checkMongoConnection,
  async (req, res) => {
    try {
      const category = req.params.category;
      const subcategory = req.params.subcategory;
      const products = await productsCollection
        .find({
          category: category,
          subcategory: subcategory,
          status: "Active",
        })
        .toArray();

      res.json({
        success: true,
        data: products,
        count: products.length,
      });
    } catch (error) {
      console.error(
        "Error fetching products by category and subcategory:",
        error
      );
      res.status(500).json({
        success: false,
        error: "Failed to fetch products by category and subcategory",
        message: error.message,
      });
    }
  }
);

/**
 * PUT /api/products/:id - Cập nhật sản phẩm
 */
app.put("/api/products/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;

    // console.log(` [Products API] Updating product with ID: ${id}`);

    // Tìm product theo _id trước (vì frontend gửi _id từ MongoDB)
    let product = await productsCollection.findOne({ _id: id });

    // Nếu không tìm thấy bằng _id, thử tìm bằng SKU
    if (!product) {
      // console.log(` [Products API] Not found by _id, trying SKU...`);
      product = await productsCollection.findOne({ sku: id });
    }

    if (!product) {
      // console.log(` [Products API] Product not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm",
      });
    }

    // console.log(
    //   ` [Products API] Found product: ${
    //     product.product_name || product.productName
    //   } (${product._id})`
    // );

    // Cập nhật post_date với thời gian hiện tại khi lưu
    const updateData = {
      ...req.body,
      post_date: new Date(), // Cập nhật ngày cập nhật mới nhất
    };

    // Ensure groups field is always an array
    if (updateData.groups === undefined) {
      // Keep existing groups if not provided
      updateData.groups = product.groups || [];
    } else if (!Array.isArray(updateData.groups)) {
      // Convert to array if not an array
      updateData.groups = [];
    }

    // Đảm bảo _id không bị thay đổi
    if (updateData._id && updateData._id !== product._id) {
      // Nếu _id trong body khác với _id hiện tại, giữ nguyên _id cũ
      delete updateData._id;
    }

    const result = await productsCollection.findOneAndUpdate(
      { _id: product._id },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({
        success: false,
        message: "Không thể cập nhật sản phẩm",
      });
    }

    // console.log(
    //   `\n✅ [Products API] Product updated successfully: ${
    //     result.value.product_name || result.value.productName
    //   }`
    // );
    // console.log(
    //   `📊 [Products API] Updated product data:`,
    //   JSON.stringify(
    //     {
    //       _id: result.value._id,
    //       product_name: result.value.product_name,
    //       stock: result.value.stock,
    //       price: result.value.price,
    //     },
    //     null,
    //     2
    //   )
    // );

    // Tự động đồng bộ với JSON file sau khi cập nhật MongoDB
    // Đợi sync hoàn thành trước khi trả response để đảm bảo file được cập nhật
    // console.log(
    //   `\n🔄 [Products API] ========== BẮT ĐẦU ĐỒNG BỘ JSON ==========`
    // );
    // console.log(`🔄 [Products API] Đang đồng bộ products với JSON file...`);

    let syncSuccess = false;
    let syncError = null;

    try {
      const syncResult = await syncProductsToJson(productsCollection);
      if (syncResult.success) {
        syncSuccess = true;
        // console.log(
        //   `✅ [Products API] ✅ Đã đồng bộ ${syncResult.count} products với JSON file`
        // );
        // console.log(
        //   `✅ [Products API] ========== ĐỒNG BỘ THÀNH CÔNG ==========\n`
        // );
      } else {
        syncError = syncResult.error;
        console.error(
          `❌ [Products API] ❌ Không thể đồng bộ JSON: ${syncResult.error}`
        );
        console.error(
          `❌ [Products API] ========== ĐỒNG BỘ THẤT BẠI ==========\n`
        );
      }
    } catch (err) {
      syncError = err;
      console.error(`❌ [Products API] ❌ Lỗi khi đồng bộ JSON:`, err);
      console.error(`❌ [Products API] Stack trace:`, err.stack);
      console.error(`❌ [Products API] ========== ĐỒNG BỘ LỖI ==========\n`);
    }

    // Log kết quả cuối cùng
    // if (syncSuccess) {
    //   console.log(
    //     `✅ [Products API] ✅ HOÀN TẤT: MongoDB đã cập nhật và JSON đã được đồng bộ\n`
    //   );
    // } else {
    //   console.error(
    //     `⚠️  [Products API] ⚠️  CẢNH BÁO: MongoDB đã cập nhật nhưng JSON chưa được đồng bộ: ${syncError}\n`
    //   );
    // }

    res.json({
      success: true,
      message: "Cập nhật sản phẩm thành công",
      data: result.value,
    });
  } catch (error) {
    console.error(" [Products API] Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật sản phẩm",
      error: error.message,
    });
  }
});

/**
 * PATCH /api/products/:id - Cập nhật một trường cụ thể của sản phẩm
 */
app.patch("/api/products/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;
    const { field, value } = req.body;

    if (!field) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chỉ định trường cần cập nhật",
      });
    }

    // console.log(
    //   ` [Products API] PATCH - Updating field "${field}" for product ID: ${id}`
    // );

    // Tìm product theo _id trước
    let product = await productsCollection.findOne({ _id: id });

    // Nếu không tìm thấy bằng _id, thử tìm bằng SKU
    if (!product) {
      // console.log(` [Products API] Not found by _id, trying SKU...`);
      product = await productsCollection.findOne({ sku: id });
    }

    if (!product) {
      // console.log(` [Products API] Product not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm",
      });
    }

    // console.log(
    //   ` [Products API] Found product: ${
    //     product.product_name || product.productName
    //   } (${product._id})`
    // );

    // Tạo update object với trường cụ thể
    const updateData = {
      [field]: value,
      post_date: new Date(), // Cập nhật ngày cập nhật mới nhất
    };

    const result = await productsCollection.findOneAndUpdate(
      { _id: product._id },
      { $set: updateData },
      { returnDocument: "after" }
    );

    if (!result.value) {
      return res.status(404).json({
        success: false,
        message: "Không thể cập nhật sản phẩm",
      });
    }

    // console.log(` [Products API] Field "${field}" updated successfully`);

    // Tự động đồng bộ với JSON file sau khi cập nhật MongoDB
    try {
      // console.log(` [Products API] Đang đồng bộ products với JSON file...`);
      const syncResult = await syncProductsToJson(productsCollection);
      // if (syncResult.success) {
      // console.log(
      //   ` [Products API] ✅ Đã đồng bộ ${syncResult.count} products với JSON file`
      // );
      // } else {
      // console.log(
      //   ` [Products API] ⚠️  Không thể đồng bộ JSON: ${syncResult.error}`
      // );
      // }
    } catch (syncError) {
      console.error(
        ` [Products API] ⚠️  Lỗi khi đồng bộ JSON: ${syncError.message}`
      );
      // Không fail request nếu sync JSON lỗi
    }

    res.json({
      success: true,
      message: `Đã cập nhật trường "${field}" thành công`,
      data: result.value,
    });
  } catch (error) {
    console.error(" [Products API] Error updating product field:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật sản phẩm",
      error: error.message,
    });
  }
});

/**
 * POST /api/products - Tạo sản phẩm mới
 */
app.post("/api/products", checkMongoConnection, async (req, res) => {
  try {
    const newProduct = {
      ...req.body,
      post_date: new Date(), // Set ngày tạo mới
      groups:
        req.body.groups && Array.isArray(req.body.groups)
          ? req.body.groups
          : [], // Initialize groups field
    };

    const result = await productsCollection.insertOne(newProduct);

    const createdProduct = { ...newProduct, _id: result.insertedId };

    // Tự động đồng bộ với JSON file sau khi tạo sản phẩm mới
    try {
      console.log(` [Products API] Đang đồng bộ products với JSON file...`);
      const syncResult = await syncProductsToJson(productsCollection);
      if (syncResult.success) {
        console.log(
          ` [Products API] ✅ Đã đồng bộ ${syncResult.count} products với JSON file`
        );
      } else {
        console.log(
          ` [Products API] ⚠️  Không thể đồng bộ JSON: ${syncResult.error}`
        );
      }
    } catch (syncError) {
      console.error(
        ` [Products API] ⚠️  Lỗi khi đồng bộ JSON: ${syncError.message}`
      );
      // Không fail request nếu sync JSON lỗi
    }

    res.status(201).json({
      success: true,
      message: "Tạo sản phẩm thành công",
      data: createdProduct,
    });
  } catch (error) {
    console.error(" [Products API] Error creating product:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo sản phẩm",
      error: error.message,
    });
  }
});

/**
 * POST /api/products/sync - Đồng bộ thủ công products từ MongoDB về JSON (for testing)
 */
app.post("/api/products/sync", checkMongoConnection, async (req, res) => {
  try {
    console.log("\n🔄 [Manual Sync] Đồng bộ products từ MongoDB về JSON...");
    const syncResult = await syncProductsToJson(productsCollection);

    if (syncResult.success) {
      res.json({
        success: true,
        message: `Đã đồng bộ ${syncResult.count} products từ MongoDB về JSON`,
        count: syncResult.count,
      });
    } else {
      res.status(500).json({
        success: false,
        error: syncResult.error || "Lỗi khi đồng bộ",
        message: "Không thể đồng bộ products",
      });
    }
  } catch (error) {
    console.error("❌ Error syncing products:", error);
    res.status(500).json({
      error: "Lỗi khi đồng bộ products",
      message: error.message,
    });
  }
});

/**
 * DELETE /api/products/:id - Xóa sản phẩm
 */
app.delete("/api/products/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`\n🗑️ === DELETE PRODUCT ===`);
    console.log(`📦 Product ID/SKU: ${id}`);

    // Strategy 1: Try to find by SKU first (most common case from frontend)
    let product = await productsCollection.findOne({ sku: id });

    // Strategy 2: If not found by SKU, try to find by _id as ObjectId
    if (!product) {
      try {
        // Check if the id is a valid MongoDB ObjectId
        if (ObjectId.isValid(id)) {
          product = await productsCollection.findOne({ _id: new ObjectId(id) });
          if (product) {
            console.log(
              `📦 [Products API] Found product by _id (ObjectId): ${product.product_name || product.productName
              }`
            );
          }
        }
      } catch (e) {
        // Invalid ObjectId format, continue
        console.log(`📦 [Products API] Invalid ObjectId format: ${id}`);
      }
    } else {
      console.log(
        `📦 [Products API] Found product by SKU: ${product.product_name || product.productName
        }`
      );
    }

    // Strategy 3: If still not found, try to find by _id as string (fallback)
    if (!product) {
      try {
        product = await productsCollection.findOne({ _id: id });
        if (product) {
          console.log(
            `📦 [Products API] Found product by _id (string): ${product.product_name || product.productName
            }`
          );
        }
      } catch (e) {
        // Ignore errors
        console.log(`📦 [Products API] Error finding by _id string: ${id}`);
      }
    }

    // Strategy 4: If still not found, try to find by product name (exact match)
    if (!product) {
      try {
        product = await productsCollection.findOne({
          $or: [{ product_name: id }, { productName: id }],
        });
        if (product) {
          console.log(
            `📦 [Products API] Found product by name (exact): ${product.product_name || product.productName
            }`
          );
        }
      } catch (e) {
        console.log(`📦 [Products API] Error finding by name: ${id}`);
      }
    }

    // Strategy 5: If still not found, try to find by product name (case-insensitive partial match)
    if (!product) {
      try {
        // Use regex for case-insensitive partial match
        const nameRegex = new RegExp(
          id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i"
        );
        product = await productsCollection.findOne({
          $or: [
            { product_name: { $regex: nameRegex } },
            { productName: { $regex: nameRegex } },
          ],
        });
        if (product) {
          console.log(
            `📦 [Products API] Found product by name (partial match): ${product.product_name || product.productName
            }`
          );
        }
      } catch (e) {
        console.log(`📦 [Products API] Error finding by name regex: ${id}`);
      }
    }

    // Strategy 6: Try to find by code field (if exists)
    if (!product) {
      try {
        product = await productsCollection.findOne({ code: id });
        if (product) {
          console.log(
            `📦 [Products API] Found product by code: ${product.product_name || product.productName
            }`
          );
        }
      } catch (e) {
        console.log(`📦 [Products API] Error finding by code: ${id}`);
      }
    }

    if (!product) {
      console.log(
        `❌ [Products API] Product not found after trying all strategies: ${id}`
      );
      console.log(
        `   Tried: SKU, _id (ObjectId), _id (string), name (exact), name (partial), code`
      );

      // Try to get a sample of products to help debug
      try {
        const sampleProducts = await productsCollection
          .find({})
          .limit(3)
          .toArray();
        console.log(`   Sample products in database:`);
        sampleProducts.forEach((p) => {
          console.log(
            `     - _id: ${p._id}, SKU: ${p.sku || "N/A"}, name: ${p.product_name || p.productName || "N/A"
            }`
          );
        });
      } catch (e) {
        // Ignore
      }

      return res.status(404).json({
        success: false,
        message: "Không tìm thấy sản phẩm",
        error: `Product with ID/SKU/Name "${id}" not found`,
        triedStrategies: [
          "SKU",
          "_id (ObjectId)",
          "_id (string)",
          "name (exact)",
          "name (partial)",
          "code",
        ],
      });
    }

    console.log(
      `✅ [Products API] Found product: ${product.product_name || product.productName
      } (${product._id})`
    );

    // Option 1: Xóa hoàn toàn (uncomment if needed)
    // const result = await productsCollection.deleteOne({ _id: product._id });

    // Option 2: Đánh dấu là inactive (recommended để giữ lịch sử)
    const result = await productsCollection.updateOne(
      { _id: product._id },
      {
        $set: {
          status: "Inactive",
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      console.log(`❌ [Products API] Failed to delete product: ${id}`);
      return res.status(500).json({
        success: false,
        message: "Không thể xóa sản phẩm",
        error: "Failed to update product status",
      });
    }

    // Get updated product
    const updatedProduct = await productsCollection.findOne({
      _id: product._id,
    });

    console.log(
      `✅ [Products API] Product deleted successfully: ${product.product_name || product.productName
      }`
    );

    // Tự động đồng bộ products về JSON sau khi xóa
    syncProductsToJsonAsync(productsCollection);

    res.json({
      success: true,
      message: "Đã xóa sản phẩm thành công",
      data: updatedProduct,
      deletedProduct: {
        _id: updatedProduct._id,
        product_name: updatedProduct.product_name || updatedProduct.productName,
        sku: updatedProduct.sku,
      },
    });
  } catch (error) {
    console.error("❌ [Products API] Error deleting product:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi xóa sản phẩm",
      error: error.message,
    });
  }
});

// ============================================================================
// PROMOTIONS ENDPOINTS
// ============================================================================

/**
 * GET all promotions
 */
app.get("/api/promotions", checkMongoConnection, async (req, res) => {
  try {
    const promotions = await promotionsCollection.find({}).toArray();
    res.json({
      success: true,
      data: promotions,
      count: promotions.length,
    });
  } catch (error) {
    console.error("Error fetching promotions:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch promotions",
      message: error.message,
    });
  }
});

/**
 * GET /api/promotions/active - Lấy các promotions đang active (status "Active" hoặc "đang diễn ra")
 * PHẢI ĐẶT TRƯỚC /api/promotions/:id để tránh conflict
 */
app.get("/api/promotions/active", checkMongoConnection, async (req, res) => {
  try {
    const currentDate = new Date(); // Dùng thời gian hiện tại chính xác (bao gồm giờ, phút, giây)
    // console.log(
    //   `🔄 [Promotions] Fetching available promotions at ${currentDate.toISOString()}`
    // );

    // Lấy tất cả promotions từ MongoDB (không filter status, usage_limit, start_date)
    // Sau đó filter ở application level để lấy:
    // - Type: không phải Admin
    // - Chưa hết hạn (end_date >= currentDate)
    const allPromotions = await promotionsCollection
      .find({
        type: { $ne: "Admin" }, // Loại bỏ promotions có type là Admin
      })
      .toArray();

    // console.log(
    //   `📋 [Promotions] Total promotions (non-Admin): ${allPromotions.length}`
    // );
    if (allPromotions.length > 0) {
      // console.log(
      //   `📋 [Promotions] All promotion codes (non-Admin):`,
      //   allPromotions.map((p) => ({
      //     code: p.code,
      //     name: p.name,
      //     status: p.status,
      //     type: p.type,
      //     end_date: p.end_date,
      //     start_date: p.start_date,
      //     usage_limit: p.usage_limit,
      //   }))
      // );
    }

    // Filter ở application level để xử lý dates chính xác hơn
    // Chỉ lấy promotions:
    // - Đã bắt đầu (start_date <= currentDate) - BẮT BUỘC phải có start_date hợp lệ
    // - Chưa hết hạn (end_date >= currentDate)
    // Tính currentTimestamp một lần để dùng lại
    const currentTimestamp = currentDate.getTime();

    const promotions = allPromotions.filter((p) => {
      // Kiểm tra start_date - BẮT BUỘC phải có start_date hợp lệ và đã bắt đầu
      const startDate = p.start_date ? new Date(p.start_date) : null;
      if (!startDate || isNaN(startDate.getTime())) {
        // console.log(
        //   `⏭️ [Promotions] Filtering out ${p.code} (invalid or missing start_date):`,
        //   {
        //     start_date: p.start_date,
        //   }
        // );
        return false; // Không có start_date hợp lệ thì loại bỏ
      }

      // So sánh timestamp để tránh vấn đề timezone
      // start_date từ MongoDB có thể là UTC (2026-01-01T00:00:00.000Z)
      // currentDate là local time, cần so sánh chính xác
      const startTimestamp = startDate.getTime();
      const hasStarted = startTimestamp <= currentTimestamp;

      if (!hasStarted) {
        // console.log(
        //   `⏭️ [Promotions] Filtering out ${p.code} (not started yet):`,
        //   {
        //     start_date: startDate.toISOString(),
        //     start_timestamp: startTimestamp,
        //     current_date: currentDate.toISOString(),
        //     current_timestamp: currentTimestamp,
        //     code: p.code,
        //     difference_ms: startTimestamp - currentTimestamp,
        //   }
        // );
        return false;
      }

      // Kiểm tra chưa hết hạn
      const endDate = p.end_date ? new Date(p.end_date) : null;
      if (!endDate || isNaN(endDate.getTime())) {
        console.warn(
          `⚠️ [Promotions] Promotion ${p.code} has invalid end_date:`,
          p.end_date
        );
        // Nếu không có end_date hợp lệ, vẫn giữ lại để người dùng thấy
        return true;
      }

      // So sánh timestamp để tránh vấn đề timezone
      const endTimestamp = endDate.getTime();
      const isNotExpired = endTimestamp >= currentTimestamp;

      // Chỉ loại bỏ nếu đã hết hạn hoàn toàn
      if (!isNotExpired) {
        // console.log(`⚠️ [Promotions] Filtering out ${p.code} (expired):`, {
        //   status: p.status,
        //   end_date: endDate.toISOString(),
        //   end_timestamp: endTimestamp,
        //   current_date: currentDate.toISOString(),
        //   current_timestamp: currentTimestamp,
        //   difference_ms: endTimestamp - currentTimestamp,
        // });
      }

      return isNotExpired;
    });

    // Sort theo ngày hết hạn (gần hết hạn lên đầu)
    promotions.sort((a, b) => {
      const endDateA = new Date(a.end_date);
      const endDateB = new Date(b.end_date);
      return endDateA.getTime() - endDateB.getTime();
    });

    // console.log(
    //   `✅ [Promotions] Found ${promotions.length} available promotions after filtering`
    // );
    // console.log(
    //   `📊 [Promotions] Filtered promotion codes:`,
    //   promotions.map((p) => p.code)
    // );

    if (promotions.length > 0) {
      // console.log(
      //   `📊 [Promotions] All promotions found:`,
      //   promotions.map((p) => ({
      //     id: p.promotion_id,
      //     code: p.code,
      //     name: p.name,
      //     status: p.status,
      //     start_date: p.start_date,
      //     end_date: p.end_date,
      //     usage_limit: p.usage_limit,
      //     type: p.type,
      //     min_order_value: p.min_order_value,
      //   }))
      // );
    } else {
      // Nếu không tìm thấy, kiểm tra xem có promotions nào trong database không
      const totalCount = await promotionsCollection.countDocuments({});
      const nonAdminCount = await promotionsCollection.countDocuments({
        type: { $ne: "Admin" },
      });
      // console.log(
      //   `⚠️ [Promotions] No available promotions found after filtering.`
      // );
      // console.log(`   - Total promotions in DB: ${totalCount}`);
      // console.log(`   - Non-Admin promotions: ${nonAdminCount}`);
    }

    // Convert dates to ISO strings for frontend
    const promotionsData = promotions.map((p) => ({
      promotion_id: p.promotion_id,
      code: p.code,
      name: p.name,
      description: p.description || "",
      type: p.type,
      scope: p.scope,
      discount_type: p.discount_type,
      discount_value: p.discount_value,
      max_discount_value: p.max_discount_value || 0,
      min_order_value: p.min_order_value || 0,
      usage_limit: p.usage_limit || 0,
      user_limit: p.user_limit || 1,
      is_first_order_only: p.is_first_order_only || false,
      start_date: p.start_date
        ? p.start_date instanceof Date
          ? p.start_date.toISOString()
          : p.start_date
        : new Date().toISOString(),
      end_date: p.end_date
        ? p.end_date instanceof Date
          ? p.end_date.toISOString()
          : p.end_date
        : new Date().toISOString(),
      status: p.status,
      created_by: p.created_by || "system",
      created_at: p.created_at
        ? p.created_at instanceof Date
          ? p.created_at.toISOString()
          : p.created_at
        : new Date().toISOString(),
      updated_at: p.updated_at
        ? p.updated_at instanceof Date
          ? p.updated_at.toISOString()
          : p.updated_at
        : new Date().toISOString(),
    }));

    // console.log(
    //   `📤 [Promotions] Sending ${promotionsData.length} promotions to frontend`
    // );
    if (promotionsData.length > 0) {
      // console.log(
      //   `📋 [Promotions] All promotions being sent:`,
      //   promotionsData.map((p) => ({
      //     code: p.code,
      //     name: p.name,
      //     status: p.status,
      //     start_date: p.start_date,
      //     end_date: p.end_date,
      //     usage_limit: p.usage_limit,
      //     min_order_value: p.min_order_value,
      //   }))
      // );
    }

    res.json({
      success: true,
      data: promotionsData,
      count: promotionsData.length,
    });
  } catch (error) {
    console.error("❌ [Promotions] Error fetching active promotions:", error);
    console.error("❌ [Promotions] Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách khuyến mãi đang hoạt động",
      error: error.message,
    });
  }
});

/**
 * GET /api/promotions/code/:code - Tìm promotion theo code
 */
app.get(
  "/api/promotions/code/:code",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { code } = req.params;
      const currentDate = new Date();

      // Hỗ trợ cả status "Active" và "đang diễn ra"
      const promotion = await promotionsCollection.findOne({
        code: { $regex: new RegExp(`^${code}$`, "i") }, // Case-insensitive
        $or: [{ status: "Active" }, { status: "đang diễn ra" }],
        type: { $ne: "Admin" },
        start_date: { $lte: currentDate },
        end_date: { $gte: currentDate },
        usage_limit: { $gt: 0 },
      });

      if (!promotion) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy mã khuyến mãi hoặc mã đã hết hạn",
        });
      }

      // Convert dates to ISO strings
      const promotionData = {
        promotion_id: promotion.promotion_id,
        code: promotion.code,
        name: promotion.name,
        description: promotion.description || "",
        type: promotion.type,
        scope: promotion.scope,
        discount_type: promotion.discount_type,
        discount_value: promotion.discount_value,
        max_discount_value: promotion.max_discount_value || 0,
        min_order_value: promotion.min_order_value || 0,
        usage_limit: promotion.usage_limit || 0,
        user_limit: promotion.user_limit || 1,
        is_first_order_only: promotion.is_first_order_only || false,
        start_date: promotion.start_date
          ? promotion.start_date instanceof Date
            ? promotion.start_date.toISOString()
            : promotion.start_date
          : new Date().toISOString(),
        end_date: promotion.end_date
          ? promotion.end_date instanceof Date
            ? promotion.end_date.toISOString()
            : promotion.end_date
          : new Date().toISOString(),
        status: promotion.status,
        created_by: promotion.created_by || "system",
        created_at: promotion.created_at
          ? promotion.created_at instanceof Date
            ? promotion.created_at.toISOString()
            : promotion.created_at
          : new Date().toISOString(),
        updated_at: promotion.updated_at
          ? promotion.updated_at instanceof Date
            ? promotion.updated_at.toISOString()
            : promotion.updated_at
          : new Date().toISOString(),
      };

      res.json({
        success: true,
        data: promotionData,
      });
    } catch (error) {
      console.error("❌ [Promotions] Error finding promotion by code:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi tìm kiếm mã khuyến mãi",
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/promotions - Create new promotion
 */
app.post("/api/promotions", checkMongoConnection, async (req, res) => {
  try {
    const promotionData = req.body;

    console.log("\n📝 === CREATE PROMOTION ===");
    console.log("📋 Promotion data:", {
      code: promotionData.code,
      name: promotionData.name,
    });

    // Validate required fields
    if (
      !promotionData.code ||
      !promotionData.name ||
      !promotionData.discount_value
    ) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin bắt buộc: code, name, discount_value",
        error: "Missing required fields",
      });
    }

    // Check if code already exists
    const existingPromotion = await promotionsCollection.findOne({
      code: promotionData.code,
    });
    if (existingPromotion) {
      return res.status(400).json({
        success: false,
        message: `Mã khuyến mãi "${promotionData.code}" đã tồn tại`,
        error: "Promotion code already exists",
      });
    }

    // Generate promotion_id if not provided
    if (!promotionData.promotion_id) {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0");
      promotionData.promotion_id = `PRO${timestamp}${random}`;
    }

    // Ensure dates are Date objects
    if (
      promotionData.start_date &&
      typeof promotionData.start_date === "string"
    ) {
      promotionData.start_date = new Date(promotionData.start_date);
    }
    if (promotionData.end_date && typeof promotionData.end_date === "string") {
      promotionData.end_date = new Date(promotionData.end_date);
    }

    // Set default values
    promotionData.created_at = promotionData.created_at || new Date();
    promotionData.updated_at = promotionData.updated_at || new Date();
    promotionData.status = promotionData.status || "Active";
    promotionData.usage_count = promotionData.usage_count || 0;

    // Insert into MongoDB
    const result = await promotionsCollection.insertOne(promotionData);

    console.log(
      `✅ Promotion created successfully: ${promotionData.promotion_id} - ${promotionData.code}`
    );

    // Get the created promotion
    const createdPromotion = await promotionsCollection.findOne({
      _id: result.insertedId,
    });

    // Create notification for all users about the new promotion
    // Only notify if promotion is Active and type is User (not Admin)
    if (
      createdPromotion &&
      createdPromotion.status === "Active" &&
      createdPromotion.type !== "Admin"
    ) {
      try {
        await createPromotionNotificationForAllUsers(createdPromotion);
      } catch (notifError) {
        console.error(
          "❌ [Notifications] Error creating promotion notifications:",
          notifError
        );
        // Don't fail the promotion creation if notification fails
      }
    }

    res.status(201).json({
      success: true,
      message: "Tạo khuyến mãi thành công",
      data: createdPromotion,
    });
  } catch (error) {
    console.error("❌ Error creating promotion:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo khuyến mãi",
      error: error.message,
    });
  }
});

/**
 * PUT /api/promotions/:id - Update promotion (can find by promotion_id or code)
 */
app.put("/api/promotions/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`\n✏️ === UPDATE PROMOTION ===`);
    console.log(`📋 Promotion ID/Code: ${id}`);
    console.log("📋 Update data:", {
      code: updateData.code,
      name: updateData.name,
    });

    // Try to find by promotion_id first, then by code
    let promotion = await promotionsCollection.findOne({ promotion_id: id });
    if (!promotion) {
      promotion = await promotionsCollection.findOne({ code: id });
    }

    if (!promotion) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khuyến mãi",
        error: "Promotion not found",
      });
    }

    // Prepare update data
    const updateFields = {
      updated_at: new Date(),
    };

    // Update all fields from request body
    if (updateData.code !== undefined) updateFields.code = updateData.code;
    if (updateData.name !== undefined) updateFields.name = updateData.name;
    if (updateData.description !== undefined)
      updateFields.description = updateData.description;
    if (updateData.type !== undefined) updateFields.type = updateData.type;
    if (updateData.scope !== undefined) updateFields.scope = updateData.scope;
    if (updateData.discount_type !== undefined)
      updateFields.discount_type = updateData.discount_type;
    if (updateData.discount_value !== undefined)
      updateFields.discount_value = Number(updateData.discount_value);
    if (updateData.max_discount_value !== undefined)
      updateFields.max_discount_value = Number(updateData.max_discount_value);
    if (updateData.min_order_value !== undefined)
      updateFields.min_order_value = Number(updateData.min_order_value);
    if (updateData.usage_limit !== undefined)
      updateFields.usage_limit = Number(updateData.usage_limit);
    if (updateData.user_limit !== undefined)
      updateFields.user_limit = Number(updateData.user_limit);
    if (updateData.is_first_order_only !== undefined)
      updateFields.is_first_order_only = updateData.is_first_order_only;
    if (updateData.status !== undefined)
      updateFields.status = updateData.status;

    // Handle dates
    if (updateData.start_date !== undefined) {
      updateFields.start_date =
        updateData.start_date instanceof Date
          ? updateData.start_date
          : new Date(updateData.start_date);
    }
    if (updateData.end_date !== undefined) {
      updateFields.end_date =
        updateData.end_date instanceof Date
          ? updateData.end_date
          : new Date(updateData.end_date);
    }

    // Update promotion
    const result = await promotionsCollection.updateOne(
      { _id: promotion._id },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khuyến mãi",
        error: "Promotion not found",
      });
    }

    console.log(
      `✅ Promotion updated successfully: ${promotion.promotion_id || promotion.code
      }`
    );

    // Get updated promotion
    const updatedPromotion = await promotionsCollection.findOne({
      _id: promotion._id,
    });

    res.json({
      success: true,
      message: "Cập nhật khuyến mãi thành công",
      data: updatedPromotion,
    });
  } catch (error) {
    console.error("❌ Error updating promotion:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật khuyến mãi",
      error: error.message,
    });
  }
});

/**
 * DELETE /api/promotions/:id - Delete promotion (can find by promotion_id or code)
 */
app.delete("/api/promotions/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`\n🗑️ === DELETE PROMOTION ===`);
    console.log(`📋 Promotion ID/Code: ${id}`);

    // Try to find by promotion_id first, then by code
    let promotion = await promotionsCollection.findOne({ promotion_id: id });
    if (!promotion) {
      promotion = await promotionsCollection.findOne({ code: id });
    }

    if (!promotion) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khuyến mãi",
        error: "Promotion not found",
      });
    }

    // Delete promotion
    const result = await promotionsCollection.deleteOne({ _id: promotion._id });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy khuyến mãi",
        error: "Promotion not found",
      });
    }

    console.log(
      `✅ Promotion deleted successfully: ${promotion.promotion_id || promotion.code
      }`
    );

    // Also delete promotion targets if exist
    try {
      await promotionTargetsCollection.deleteMany({
        promotion_id: promotion.promotion_id || id,
      });
      console.log(
        `✅ Deleted promotion targets for: ${promotion.promotion_id || id}`
      );
    } catch (targetError) {
      console.log(
        "⚠️ Could not delete promotion targets (might not exist):",
        targetError.message
      );
    }

    res.json({
      success: true,
      message: "Xóa khuyến mãi thành công",
      data: promotion,
    });
  } catch (error) {
    console.error("❌ Error deleting promotion:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa khuyến mãi",
      error: error.message,
    });
  }
});

/**
 * GET all promotion targets
 */
app.get("/api/promotion-targets", checkMongoConnection, async (req, res) => {
  try {
    const targets = await promotionTargetsCollection.find({}).toArray();
    res.json({
      success: true,
      data: targets,
      count: targets.length,
    });
  } catch (error) {
    console.error("Error fetching promotion targets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch promotion targets",
      message: error.message,
    });
  }
});

/**
 * GET promotion target by promotion_id
 */
app.get(
  "/api/promotion-targets/:promotionId",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { promotionId } = req.params;
      const target = await promotionTargetsCollection.findOne({
        promotion_id: promotionId,
      });

      if (!target) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy promotion target",
          error: "Promotion target not found",
        });
      }

      res.json({
        success: true,
        data: target,
      });
    } catch (error) {
      console.error("Error fetching promotion target:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy promotion target",
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/promotion-targets - Create or update promotion target
 */
app.post("/api/promotion-targets", checkMongoConnection, async (req, res) => {
  try {
    const { promotion_id, target_type, target_ref } = req.body;

    console.log("\n🎯 === CREATE/UPDATE PROMOTION TARGET ===");
    console.log("📋 Promotion ID:", promotion_id, "Target type:", target_type);

    // Validate required fields
    if (
      !promotion_id ||
      !target_type ||
      !target_ref ||
      !Array.isArray(target_ref)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Thiếu thông tin bắt buộc: promotion_id, target_type, target_ref",
        error: "Missing required fields",
      });
    }

    // Check if target already exists for this promotion
    const existingTarget = await promotionTargetsCollection.findOne({
      promotion_id,
    });

    if (existingTarget) {
      // Update existing target
      const result = await promotionTargetsCollection.updateOne(
        { promotion_id },
        { $set: { target_type, target_ref, updated_at: new Date() } }
      );

      const updatedTarget = await promotionTargetsCollection.findOne({
        promotion_id,
      });

      console.log(`✅ Promotion target updated: ${promotion_id}`);

      return res.json({
        success: true,
        message: "Cập nhật promotion target thành công",
        data: updatedTarget,
      });
    }

    // Create new target
    const targetData = {
      promotion_id,
      target_type,
      target_ref,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const result = await promotionTargetsCollection.insertOne(targetData);
    const newTarget = await promotionTargetsCollection.findOne({
      _id: result.insertedId,
    });

    console.log(`✅ Promotion target created: ${promotion_id}`);

    res.status(201).json({
      success: true,
      message: "Tạo promotion target thành công",
      data: newTarget,
    });
  } catch (error) {
    console.error("❌ Error creating/updating promotion target:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo promotion target",
      error: error.message,
    });
  }
});

/**
 * PUT /api/promotion-targets/:promotionId - Update promotion target
 */
app.put(
  "/api/promotion-targets/:promotionId",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { promotionId } = req.params;
      const { target_type, target_ref } = req.body;

      console.log(`\n✏️ === UPDATE PROMOTION TARGET ===`);
      console.log(`📋 Promotion ID: ${promotionId}`);

      // Validate required fields
      if (!target_type || !target_ref || !Array.isArray(target_ref)) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin bắt buộc: target_type, target_ref",
          error: "Missing required fields",
        });
      }

      // Find and update target
      const result = await promotionTargetsCollection.updateOne(
        { promotion_id: promotionId },
        { $set: { target_type, target_ref, updated_at: new Date() } }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy promotion target",
          error: "Promotion target not found",
        });
      }

      console.log(`✅ Promotion target updated: ${promotionId}`);

      const updatedTarget = await promotionTargetsCollection.findOne({
        promotion_id: promotionId,
      });

      res.json({
        success: true,
        message: "Cập nhật promotion target thành công",
        data: updatedTarget,
      });
    } catch (error) {
      console.error("❌ Error updating promotion target:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi cập nhật promotion target",
        error: error.message,
      });
    }
  }
);

/**
 * DELETE /api/promotion-targets/:promotionId - Delete promotion target
 */
app.delete(
  "/api/promotion-targets/:promotionId",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { promotionId } = req.params;

      console.log(`\n🗑️ === DELETE PROMOTION TARGET ===`);
      console.log(`📋 Promotion ID: ${promotionId}`);

      const result = await promotionTargetsCollection.deleteOne({
        promotion_id: promotionId,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy promotion target",
          error: "Promotion target not found",
        });
      }

      console.log(`✅ Promotion target deleted: ${promotionId}`);

      res.json({
        success: true,
        message: "Xóa promotion target thành công",
      });
    } catch (error) {
      console.error("❌ Error deleting promotion target:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi xóa promotion target",
        error: error.message,
      });
    }
  }
);

// ============================================================================
// KEYWORD EXTRACTION AND RELATED PRODUCTS (Must be before /:id route)
// ============================================================================

/**
 * Extract keywords from blog content and title
 * Returns array of relevant keywords for product matching
 */
function extractKeywordsFromBlog(title, content, categoryTag) {
  // Stop words (common Vietnamese words to filter out)
  const stopWords = new Set([
    "và",
    "của",
    "cho",
    "với",
    "từ",
    "trong",
    "trên",
    "dưới",
    "về",
    "đến",
    "là",
    "có",
    "được",
    "một",
    "các",
    "những",
    "này",
    "đó",
    "nào",
    "đã",
    "sẽ",
    "cũng",
    "rất",
    "nhất",
    "nhiều",
    "ít",
    "mới",
    "cũ",
    "tốt",
    "xấu",
    "nên",
    "không",
    "chưa",
    "đã",
    "đang",
    "sẽ",
    "để",
    "mà",
    "thì",
    "nếu",
    "khi",
    "như",
    "vì",
    "do",
    "bởi",
    "ở",
    "tại",
    "vào",
    "ra",
    "lên",
    "xuống",
    "theo",
    "sau",
    "trước",
    "giữa",
    "quanh",
    "gần",
    "xa",
    "đây",
    "đấy",
    "cái",
    "chiếc",
    "con",
    "người",
    "việc",
    "điều",
    "chuyện",
    "bài",
    "bản",
    "của bạn",
    "của tôi",
    "chúng ta",
    "họ",
    "anh",
    "chị",
    "em",
    "ông",
    "bà",
  ]);

  // Common product-related keywords (to prioritize) - expanded list for better matching
  const productKeywords = [
    // Rau củ quả - general
    "nấm",
    "rau",
    "củ",
    "quả",
    "trái cây",
    "trái",
    "hoa quả",
    "rau củ",
    "rau củ quả",
    "rau xanh",
    "rau sống",
    "rau tươi",
    "rau sạch",
    // Trái cây - specific
    "cam",
    "quýt",
    "bưởi",
    "chanh",
    "táo",
    "lê",
    "nho",
    "dâu",
    "kiwi",
    "đu đủ",
    "ổi",
    "dưa hấu",
    "dưa lưới",
    "mít",
    "sầu riêng",
    "xoài",
    "măng cụt",
    "chôm chôm",
    "thanh long",
    "nhãn",
    "vải",
    "mận",
    "đào",
    // Rau củ - specific
    "cà chua",
    "dưa chuột",
    "cà rốt",
    "khoai tây",
    "khoai lang",
    "khoai môn",
    "khoai sọ",
    "cải",
    "bắp cải",
    "súp lơ",
    "bông cải",
    "cải bó xôi",
    "cải thìa",
    "cải ngọt",
    "rau muống",
    "rau cải",
    "rau dền",
    "rau mồng tơi",
    "rau ngót",
    "rau lang",
    "hành",
    "tỏi",
    "gừng",
    "nghệ",
    "ớt",
    "ớt chuông",
    "đậu",
    "đỗ",
    "đậu phụ",
    "đậu nành",
    "đậu xanh",
    "đậu đen",
    "đậu đỏ",
    // Thịt, cá, hải sản
    "thịt",
    "thịt heo",
    "thịt bò",
    "thịt gà",
    "thịt vịt",
    "cá",
    "cá hồi",
    "cá basa",
    "cá thu",
    "cá ngừ",
    "cá chép",
    "tôm",
    "cua",
    "ghẹ",
    "mực",
    "bạch tuộc",
    "nghêu",
    "sò",
    "hàu",
    // Ngũ cốc, gạo
    "gạo",
    "bột",
    "ngũ cốc",
    "cereals",
    "yến mạch",
    "lúa mì",
    "bánh mì",
    // Sữa và sản phẩm từ sữa
    "sữa",
    "phô mai",
    "bơ",
    "yogurt",
    "sữa chua",
    "kem",
    // Gia vị, đồ khô
    "lạc",
    "vừng",
    "mè",
    "hạt điều",
    "hạnh nhân",
    "óc chó",
    // Dinh dưỡng
    "vitamin",
    "vitamin c",
    "vitamin a",
    "vitamin d",
    "vitamin e",
    "vitamin b",
    "chất xơ",
    "protein",
    "canxi",
    "sắt",
    "kẽm",
    "omega",
    "axit folic",
    "chống oxy hóa",
    "tăng cường",
    "miễn dịch",
    "sức khỏe",
    // Tính chất
    "tươi",
    "sống",
    "sạch",
    "organic",
    "hữu cơ",
    "tự nhiên",
    "giảm",
    "tăng",
    "hỗ trợ",
    "bảo vệ",
    "cải thiện",
    "ngăn ngừa",
  ];

  // Combine title, content, and categoryTag
  const combinedText = `${title || ""} ${content || ""} ${categoryTag || ""
    }`.toLowerCase();

  // Remove HTML tags
  const textWithoutHtml = combinedText.replace(/<[^>]*>/g, " ");

  // Extract words (Vietnamese and English)
  const words = textWithoutHtml
    .replace(
      /[^\w\sàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/gi,
      " "
    )
    .split(/\s+/)
    .filter((word) => word.length > 1); // Filter out single characters

  // Extract multi-word phrases (2-3 words)
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) {
    const twoWord = `${words[i]} ${words[i + 1]}`;
    if (twoWord.length > 3 && !stopWords.has(twoWord)) {
      phrases.push(twoWord);
    }
    if (i < words.length - 2) {
      const threeWord = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (threeWord.length > 5 && !stopWords.has(threeWord)) {
        phrases.push(threeWord);
      }
    }
  }

  // Combine single words and phrases
  const allKeywords = [...words, ...phrases];

  // Filter out stop words and prioritize product keywords
  const filteredKeywords = allKeywords
    .filter((word) => {
      const lowerWord = word.toLowerCase();
      // Keep if it's a product keyword or not a stop word
      return (
        productKeywords.some((pk) => lowerWord.includes(pk.toLowerCase())) ||
        (!stopWords.has(lowerWord) && lowerWord.length > 2)
      );
    })
    .map((word) => word.toLowerCase().trim())
    .filter((word, index, self) => self.indexOf(word) === index) // Remove duplicates
    .slice(0, 30); // Increase to 30 keywords for better subcategory matching

  // Prioritize longer keywords (more specific) - these are more likely to match subcategories
  filteredKeywords.sort((a, b) => {
    // First sort by length (longer = more specific)
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    // Then prioritize product keywords
    const aIsProductKeyword = productKeywords.some((pk) =>
      a.includes(pk.toLowerCase())
    );
    const bIsProductKeyword = productKeywords.some((pk) =>
      b.includes(pk.toLowerCase())
    );
    if (aIsProductKeyword && !bIsProductKeyword) return -1;
    if (!aIsProductKeyword && bIsProductKeyword) return 1;
    return 0;
  });

  return filteredKeywords;
}

/**
 * Generate hashtags from keywords
 */
function generateHashtags(keywords, categoryTag) {
  const hashtags = new Set();

  // Add category tag as hashtag
  if (categoryTag) {
    hashtags.add(`#${categoryTag.replace(/\s+/g, "")}`);
  }

  // Add top keywords as hashtags
  keywords.slice(0, 10).forEach((keyword) => {
    // Remove spaces and special characters for hashtag
    const hashtag = keyword
      .replace(/\s+/g, "")
      .replace(
        /[^\wàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/gi,
        ""
      )
      .toLowerCase();

    if (hashtag.length > 2) {
      hashtags.add(`#${hashtag}`);
    }
  });

  return Array.from(hashtags).slice(0, 10); // Limit to 10 hashtags
}

/**
 * GET /api/blogs/:id/related-products - Get related products based on blog content
 * Must be placed BEFORE /:id route to avoid conflicts
 * Improved: Match keywords with subcategories first, then suggest products
 */
app.get(
  "/api/blogs/:id/related-products",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const normalizedId = id.trim().replace(/,$/, "").trim();

      // Find blog
      const escapedId = normalizedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const idRegex = new RegExp(`^${escapedId},?$`);

      let blog = await blogsCollection.findOne({
        $or: [
          { id: normalizedId },
          { id: normalizedId + "," },
          { id: { $regex: idRegex } },
        ],
      });

      if (!blog) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy bài viết",
        });
      }

      // PRIORITY 1: Use hashtags first (if available) - they are already extracted and formatted
      const matchedSubcategories = [];
      const matchedKeywords = [];
      const matchedHashtags = [];

      // Get all unique subcategories from database
      const allSubcategories = await productsCollection.distinct(
        "subcategory",
        {
          status: "Active",
          subcategory: { $exists: true, $ne: null, $ne: "" },
        }
      );

      // console.log(
      //   `📊 [Blogs] Found ${allSubcategories.length} unique subcategories in database`
      // );

      // PRIORITY 1: Match hashtags with subcategories first (highest priority)
      if (
        blog.hashtags &&
        Array.isArray(blog.hashtags) &&
        blog.hashtags.length > 0
      ) {
        // console.log(
        //   `🏷️ [Blogs] Checking ${blog.hashtags.length} hashtags for subcategory matches...`
        // );

        blog.hashtags.forEach((hashtag) => {
          // Remove # symbol and normalize
          const tag = hashtag.replace(/^#/, "").toLowerCase().trim();

          allSubcategories.forEach((subcat) => {
            if (subcat) {
              const lowerSubcat = subcat.toLowerCase().trim();

              // Improved matching: exact match, contains, or word boundary match
              if (
                lowerSubcat === tag ||
                lowerSubcat.includes(tag) ||
                tag.includes(lowerSubcat) ||
                // Word boundary matching (e.g., "rau củ" matches "rau củ quả")
                new RegExp(
                  `\\b${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                  "i"
                ).test(lowerSubcat) ||
                new RegExp(
                  `\\b${lowerSubcat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                  "i"
                ).test(tag)
              ) {
                if (!matchedSubcategories.includes(subcat)) {
                  matchedSubcategories.push(subcat);
                  matchedHashtags.push(hashtag);
                  // console.log(
                  //   `✅ [Blogs] Matched hashtag "${hashtag}" with subcategory "${subcat}"`
                  // );
                }
              }
            }
          });
        });
      }

      // PRIORITY 2: Extract and match keywords from blog content
      const keywords = extractKeywordsFromBlog(
        blog.title || "",
        blog.content || "",
        blog.categoryTag || ""
      );

      // console.log(
      //   `📝 [Blogs] Extracted ${keywords.length} keywords for blog "${blog.title}":`,
      //   keywords
      // );

      // Match keywords with subcategories (case-insensitive, partial match)
      keywords.forEach((keyword) => {
        const lowerKeyword = keyword.toLowerCase().trim();

        // Skip if already matched by hashtag
        if (
          matchedHashtags.some(
            (ht) => ht.replace(/^#/, "").toLowerCase().trim() === lowerKeyword
          )
        ) {
          return;
        }

        // Check if keyword matches any subcategory
        allSubcategories.forEach((subcat) => {
          if (subcat) {
            const lowerSubcat = subcat.toLowerCase().trim();

            // Improved matching: exact match, contains, or word boundary match
            if (
              lowerSubcat === lowerKeyword ||
              lowerSubcat.includes(lowerKeyword) ||
              lowerKeyword.includes(lowerSubcat) ||
              // Word boundary matching
              new RegExp(
                `\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                "i"
              ).test(lowerSubcat) ||
              new RegExp(
                `\\b${lowerSubcat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                "i"
              ).test(lowerKeyword)
            ) {
              if (!matchedSubcategories.includes(subcat)) {
                matchedSubcategories.push(subcat);
                matchedKeywords.push(keyword);
                // console.log(
                //   `✅ [Blogs] Matched keyword "${keyword}" with subcategory "${subcat}"`
                // );
              }
            }
          }
        });
      });

      // console.log(
      //   `🎯 [Blogs] Matched ${matchedSubcategories.length} subcategories:`,
      //   matchedSubcategories
      // );
      // console.log(
      //   `🏷️ [Blogs] Matched ${matchedHashtags.length} hashtags:`,
      //   matchedHashtags
      // );
      // console.log(
      //   `🔑 [Blogs] Matched ${matchedKeywords.length} keywords:`,
      //   matchedKeywords
      // );

      // Build search query - PRIORITIZE subcategory matches first
      let products = [];

      // Step 1: If we have matched subcategories, search by them first (highest priority)
      if (matchedSubcategories.length > 0) {
        // Build $or conditions for subcategory matching
        const subcategoryConditions = [];
        matchedSubcategories.forEach((subcat) => {
          const escapedSubcat = subcat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          subcategoryConditions.push(
            { subcategory: { $regex: escapedSubcat, $options: "i" } },
            { Subcategory: { $regex: escapedSubcat, $options: "i" } }
          );
        });

        const subcategoryQuery = {
          status: "Active",
          $or: subcategoryConditions,
        };

        products = await productsCollection
          .find(subcategoryQuery)
          .limit(12)
          .project({
            _id: 1,
            sku: 1,
            product_name: 1,
            productName: 1,
            ProductName: 1,
            category: 1,
            Category: 1,
            subcategory: 1,
            Subcategory: 1,
            brand: 1,
            Brand: 1,
            price: 1,
            image: 1,
            status: 1,
            unit: 1,
            purchase_count: 1,
          })
          .toArray();

        // console.log(
        //   `✅ [Blogs] Found ${products.length} products by subcategory match`
        // );
      }

      // Step 2: If we don't have enough products, search by keywords in other fields
      if (products.length < 12 && keywords.length > 0) {
        const remainingLimit = 12 - products.length;
        const existingSkus = new Set(
          products.map((p) => (p.sku || p._id || "").toString())
        );
        const existingIds = new Set(
          products.map((p) => (p._id || "").toString())
        );

        // Build keyword search conditions
        const keywordSearchConditions = [
          // Search in product name
          { product_name: { $regex: keywords.join("|"), $options: "i" } },
          { productName: { $regex: keywords.join("|"), $options: "i" } },
          { ProductName: { $regex: keywords.join("|"), $options: "i" } },
          // Search in category
          { category: { $regex: keywords.join("|"), $options: "i" } },
          { Category: { $regex: keywords.join("|"), $options: "i" } },
          // Search in brand
          { brand: { $regex: keywords.join("|"), $options: "i" } },
          { Brand: { $regex: keywords.join("|"), $options: "i" } },
        ];

        // If categoryTag exists, also search by it
        if (blog.categoryTag) {
          keywordSearchConditions.push(
            { category: { $regex: blog.categoryTag, $options: "i" } },
            { Category: { $regex: blog.categoryTag, $options: "i" } }
          );
        }

        const keywordQuery = {
          status: "Active",
          $or: keywordSearchConditions,
        };

        // Fetch more products than needed to account for exclusions
        const allKeywordProducts = await productsCollection
          .find(keywordQuery)
          .limit(remainingLimit * 2) // Fetch more to filter out duplicates
          .project({
            _id: 1,
            sku: 1,
            product_name: 1,
            productName: 1,
            ProductName: 1,
            category: 1,
            Category: 1,
            subcategory: 1,
            Subcategory: 1,
            brand: 1,
            Brand: 1,
            price: 1,
            image: 1,
            status: 1,
            unit: 1,
            purchase_count: 1,
          })
          .toArray();

        // Filter out already found products
        const additionalProducts = allKeywordProducts
          .filter((p) => {
            const sku = (p.sku || p._id || "").toString();
            const id = (p._id || "").toString();
            return !existingSkus.has(sku) && !existingIds.has(id);
          })
          .slice(0, remainingLimit);

        products = [...products, ...additionalProducts];
        // console.log(
        //   `✅ [Blogs] Added ${additionalProducts.length} products by keyword match`
        // );
      }

      // Step 3: If still not enough, search by categoryTag
      if (products.length < 12 && blog.categoryTag) {
        const remainingLimit = 12 - products.length;
        const existingSkus = new Set(
          products.map((p) => (p.sku || p._id || "").toString())
        );
        const existingIds = new Set(
          products.map((p) => (p._id || "").toString())
        );

        const categoryQuery = {
          status: "Active",
          $or: [
            { category: { $regex: blog.categoryTag, $options: "i" } },
            { Category: { $regex: blog.categoryTag, $options: "i" } },
          ],
        };

        // Fetch more products than needed to account for exclusions
        const allCategoryProducts = await productsCollection
          .find(categoryQuery)
          .limit(remainingLimit * 2) // Fetch more to filter out duplicates
          .project({
            _id: 1,
            sku: 1,
            product_name: 1,
            productName: 1,
            ProductName: 1,
            category: 1,
            Category: 1,
            subcategory: 1,
            Subcategory: 1,
            brand: 1,
            Brand: 1,
            price: 1,
            image: 1,
            status: 1,
            unit: 1,
            purchase_count: 1,
          })
          .toArray();

        // Filter out already found products
        const categoryProducts = allCategoryProducts
          .filter((p) => {
            const sku = (p.sku || p._id || "").toString();
            const id = (p._id || "").toString();
            return !existingSkus.has(sku) && !existingIds.has(id);
          })
          .slice(0, remainingLimit);

        products = [...products, ...categoryProducts];
        // console.log(
        //   `✅ [Blogs] Added ${categoryProducts.length} products by category match`
        // );
      }

      // console.log(
      //   `✅ [Blogs] Total found ${products.length} related products for blog "${blog.title}"`
      // );
      // console.log(
      //   `📊 [Blogs] Matched subcategories: ${
      //     matchedSubcategories.join(", ") || "none"
      //   }`
      // );
      // console.log(
      //   `🔑 [Blogs] Matched keywords: ${matchedKeywords.join(", ") || "none"}`
      // );

      // Log sample product to verify unit and purchase_count
      if (products.length > 0) {
        const sampleProduct = products[0];
        // console.log(
        //   `📦 [Blogs - SERVER.JS] Sample product fields:`,
        //   Object.keys(sampleProduct)
        // );
        // console.log(
        //   `📦 [Blogs - SERVER.JS] Sample product unit/purchase_count:`,
        //   {
        //     unit: sampleProduct.unit,
        //     Unit: sampleProduct.Unit,
        //     purchase_count: sampleProduct.purchase_count,
        //     purchaseCount: sampleProduct.purchaseCount,
        //   }
        // );
      }

      res.json({
        success: true,
        data: products.slice(0, 12), // Ensure max 12 products
        keywords: keywords,
        matchedSubcategories: matchedSubcategories,
        matchedKeywords: matchedKeywords,
        count: products.length,
      });
    } catch (error) {
      console.error("❌ [Blogs] Error fetching related products:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi lấy sản phẩm liên quan",
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/blogs/:id/extract-keywords - Extract keywords and generate hashtags
 * Must be placed BEFORE /:id route to avoid conflicts
 */
app.post(
  "/api/blogs/:id/extract-keywords",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const normalizedId = id.trim().replace(/,$/, "").trim();

      // Find blog
      const escapedId = normalizedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const idRegex = new RegExp(`^${escapedId},?$`);

      let blog = await blogsCollection.findOne({
        $or: [
          { id: normalizedId },
          { id: normalizedId + "," },
          { id: { $regex: idRegex } },
        ],
      });

      if (!blog) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy bài viết",
        });
      }

      // Extract keywords
      const keywords = extractKeywordsFromBlog(
        blog.title || "",
        blog.content || "",
        blog.categoryTag || ""
      );

      // Generate hashtags
      const hashtags = generateHashtags(keywords, blog.categoryTag);

      // Update blog with hashtags
      await blogsCollection.updateOne(
        { _id: blog._id },
        { $set: { hashtags: hashtags } }
      );

      // console.log(
      //   `✅ [Blogs] Generated hashtags for blog "${blog.title}":`,
      //   hashtags
      // );

      res.json({
        success: true,
        data: {
          keywords: keywords,
          hashtags: hashtags,
        },
      });
    } catch (error) {
      console.error("❌ [Blogs] Error extracting keywords:", error);
      res.status(500).json({
        success: false,
        message: "Lỗi khi extract keywords",
        error: error.message,
      });
    }
  }
);

/**
 * GET all blogs
 */
app.get("/api/blogs", checkMongoConnection, async (req, res) => {
  try {
    const blogs = await blogsCollection
      .find({
        $or: [
          { status: "Active" },
          { status: { $exists: false } },
          { status: null },
        ],
      })
      .sort({ pubDate: -1 })
      .toArray();

    // Normalize blog IDs: trim và loại bỏ dấu phẩy thừa
    const normalizedBlogs = blogs.map((blog) => {
      if (blog.id && typeof blog.id === "string") {
        blog.id = blog.id.trim().replace(/,$/, "").trim();
      }
      return blog;
    });

    res.json({
      success: true,
      data: normalizedBlogs,
      count: normalizedBlogs.length,
    });
  } catch (error) {
    console.error("Error fetching blogs:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch blogs",
      message: error.message,
    });
  }
});

/**
 * GET blog by ID
 */
app.get("/api/blogs/:id", checkMongoConnection, async (req, res) => {
  try {
    let { id } = req.params;
    // Trim ID để loại bỏ khoảng trắng và dấu phẩy thừa
    id = id.trim().replace(/,$/, "").trim();
    // console.log(` [Blogs] Fetching blog with ID: "${id}"`);

    // Tạo regex để tìm ID với hoặc không có dấu phẩy ở cuối
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idRegex = new RegExp(`^${escapedId},?$`);

    // Tìm blog với ID đã trim, và cả với các biến thể có dấu phẩy/khoảng trắng
    let blog = await blogsCollection.findOne({
      $and: [
        {
          $or: [
            { id: id }, // Exact match với ID đã trim
            { id: id + "," }, // ID với dấu phẩy ở cuối
            { id: { $regex: idRegex } }, // Regex match (id hoặc id,)
          ],
        },
        {
          $or: [
            { status: "Active" },
            { status: { $exists: false } },
            { status: null },
            { status: "" },
          ],
        },
      ],
    });

    // Nếu không tìm thấy với điều kiện status, thử tìm không có điều kiện status
    if (!blog) {
      blog = await blogsCollection.findOne({
        $or: [{ id: id }, { id: id + "," }, { id: { $regex: idRegex } }],
      });
    }

    if (!blog) {
      // console.log(` [Blogs] Blog with ID "${id}" not found`);
      // Debug: Liệt kê một số IDs có trong database
      const sampleBlogs = await blogsCollection.find({}).limit(10).toArray();
      // console.log(
      //   ` [Blogs] Sample blog IDs in database:`,
      //   sampleBlogs.map((b) => ({
      //     id: `"${b.id}"`,
      //     title: b.title,
      //     status: b.status,
      //   }))
      // );
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy bài viết",
      });
    }

    // console.log(
    //   ` [Blogs] Found blog: ${blog.title} (id: "${blog.id}", status: ${
    //     blog.status || "undefined"
    //   })`
    // );

    // Normalize blog ID: trim và loại bỏ dấu phẩy thừa (nếu có)
    const normalizedBlog = { ...blog };
    if (normalizedBlog.id && typeof normalizedBlog.id === "string") {
      normalizedBlog.id = normalizedBlog.id.trim().replace(/,$/, "").trim();
    }

    // Tăng views
    const newViews = (blog.views || 0) + 1;
    await blogsCollection.updateOne(
      { _id: blog._id },
      { $set: { views: newViews } }
    );
    normalizedBlog.views = newViews;

    res.json({
      success: true,
      data: normalizedBlog, // Trả về blog với ID đã normalize
    });
  } catch (error) {
    console.error(" [Blogs] Error fetching blog:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi lấy bài viết",
      error: error.message,
    });
  }
});

/**
 * POST /api/blogs - Create new blog
 */
app.post("/api/blogs", checkMongoConnection, async (req, res) => {
  try {
    const {
      id,
      title,
      author,
      email,
      categoryTag,
      content,
      hashtags,
      img,
      excerpt,
      pubDate,
      status,
      views,
    } = req.body;

    console.log("\n📝 === CREATE BLOG ===");
    console.log("📋 Blog data:", { id, title, author, email, categoryTag });

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tiêu đề bài viết không được để trống",
        error: "Title is required",
      });
    }

    if (!author || !author.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tác giả không được để trống",
        error: "Author is required",
      });
    }

    // Generate blog ID if not provided
    let blogId = id;
    if (!blogId) {
      // Get the latest blog to generate next ID
      const latestBlog = await blogsCollection
        .find({})
        .sort({ pubDate: -1 })
        .limit(1)
        .toArray();
      if (latestBlog.length > 0 && latestBlog[0].id) {
        const match = latestBlog[0].id.match(/B(\d+)/);
        if (match) {
          const nextNum = parseInt(match[1]) + 1;
          blogId = `B${String(nextNum).padStart(4, "0")}`;
        } else {
          blogId = `B0001`;
        }
      } else {
        blogId = `B0001`;
      }
    }

    // Check if blog ID already exists
    const existingBlog = await blogsCollection.findOne({ id: blogId });
    if (existingBlog) {
      return res.status(400).json({
        success: false,
        message: `Blog với ID ${blogId} đã tồn tại`,
        error: "Blog ID already exists",
      });
    }

    // Prepare blog data
    // Extract image from content if img is not provided
    let blogImg = img;
    if (!blogImg || blogImg.trim() === "") {
      // Try to extract image from content (HTML)
      if (content) {
        const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch && imgMatch[1]) {
          blogImg = imgMatch[1];
        }
      }
      // Default placeholder if no image found
      if (!blogImg || blogImg.trim() === "") {
        blogImg = "https://via.placeholder.com/800x400?text=Blog+Image";
      }
    }

    // Auto-extract keywords and generate hashtags if content is provided
    let finalHashtags = hashtags;
    if (
      !finalHashtags ||
      (Array.isArray(finalHashtags) && finalHashtags.length === 0)
    ) {
      // Auto-generate hashtags from content
      const keywords = extractKeywordsFromBlog(
        title || "",
        content || "",
        categoryTag || ""
      );
      finalHashtags = generateHashtags(keywords, categoryTag || "");
      // console.log(
      //   `✅ [Blogs] Auto-generated hashtags for new blog "${title}":`,
      //   finalHashtags
      // );
    } else if (typeof finalHashtags === "string") {
      // Convert string to array if needed
      finalHashtags = finalHashtags.trim()
        ? finalHashtags
          .split(",")
          .map((h) => h.trim())
          .filter((h) => h)
        : [];
    } else if (!Array.isArray(finalHashtags)) {
      finalHashtags = [];
    }

    const blogData = {
      id: blogId,
      title: title.trim(),
      author: author.trim(),
      email: email || "",
      categoryTag: categoryTag || "Sức khỏe",
      content: content || "",
      hashtags: finalHashtags, // Array of hashtags
      img: blogImg,
      excerpt:
        excerpt ||
        (content ? content.replace(/<[^>]*>/g, "").substring(0, 200) : ""),
      pubDate: pubDate ? new Date(pubDate) : new Date(),
      status: status || "Active",
      views: views || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert into MongoDB
    const result = await blogsCollection.insertOne(blogData);

    console.log(`✅ Blog created successfully: ${blogId} - ${title}`);

    // Get the created blog
    const createdBlog = await blogsCollection.findOne({
      _id: result.insertedId,
    });

    // Tự động đồng bộ blogs về JSON sau khi tạo
    syncBlogsToJsonAsync(blogsCollection);

    res.status(201).json({
      success: true,
      message: "Tạo bài viết thành công",
      data: createdBlog,
    });
  } catch (error) {
    console.error("❌ Error creating blog:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi tạo bài viết",
      error: error.message,
    });
  }
});

/**
 * PUT /api/blogs/:id - Update blog
 */
app.put("/api/blogs/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      author,
      email,
      categoryTag,
      content,
      hashtags,
      img,
      excerpt,
      pubDate,
      status,
      views,
    } = req.body;

    console.log(`\n✏️ === UPDATE BLOG ===`);
    console.log(`📋 Blog ID: ${id}`);
    console.log("📋 Update data:", { title, author, email, categoryTag });

    // Find blog by id
    const blog = await blogsCollection.findOne({ id: id });
    if (!blog) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy bài viết",
        error: "Blog not found",
      });
    }

    // Prepare update data
    const updateData = {
      updatedAt: new Date(),
    };

    if (title !== undefined) updateData.title = title.trim();
    if (author !== undefined) updateData.author = author.trim();
    if (email !== undefined) updateData.email = email || "";
    if (categoryTag !== undefined) updateData.categoryTag = categoryTag;
    if (content !== undefined) updateData.content = content;
    if (img !== undefined) updateData.img = img;
    if (excerpt !== undefined) updateData.excerpt = excerpt;
    if (pubDate !== undefined) updateData.pubDate = new Date(pubDate);
    if (status !== undefined) updateData.status = status;
    if (views !== undefined) updateData.views = views;

    // Handle hashtags: auto-generate if not provided or if content/title/category changed
    if (
      hashtags === undefined ||
      hashtags === null ||
      (Array.isArray(hashtags) && hashtags.length === 0)
    ) {
      // Auto-generate hashtags if content, title, or categoryTag is updated
      const finalTitle = title !== undefined ? title : blog.title || "";
      const finalContent = content !== undefined ? content : blog.content || "";
      const finalCategoryTag =
        categoryTag !== undefined ? categoryTag : blog.categoryTag || "";

      const keywords = extractKeywordsFromBlog(
        finalTitle,
        finalContent,
        finalCategoryTag
      );
      const generatedHashtags = generateHashtags(keywords, finalCategoryTag);
      updateData.hashtags = generatedHashtags;
      // console.log(
      //   `✅ [Blogs] Auto-generated hashtags for blog "${finalTitle}":`,
      //   generatedHashtags
      // );
    } else {
      // Use provided hashtags
      if (typeof hashtags === "string") {
        // Convert string to array
        updateData.hashtags = hashtags.trim()
          ? hashtags
            .split(",")
            .map((h) => h.trim())
            .filter((h) => h)
          : [];
      } else if (Array.isArray(hashtags)) {
        updateData.hashtags = hashtags;
      } else {
        updateData.hashtags = [];
      }
    }

    // Update blog
    const result = await blogsCollection.updateOne(
      { id: id },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy bài viết",
        error: "Blog not found",
      });
    }

    console.log(`✅ Blog updated successfully: ${id}`);

    // Get updated blog
    const updatedBlog = await blogsCollection.findOne({ id: id });

    // Tự động đồng bộ blogs về JSON sau khi cập nhật
    syncBlogsToJsonAsync(blogsCollection);

    res.json({
      success: true,
      message: "Cập nhật bài viết thành công",
      data: updatedBlog,
    });
  } catch (error) {
    console.error("❌ Error updating blog:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi cập nhật bài viết",
      error: error.message,
    });
  }
});

/**
 * DELETE /api/blogs/:id - Delete blog
 */
app.delete("/api/blogs/:id", checkMongoConnection, async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`\n🗑️ === DELETE BLOG ===`);
    console.log(`📋 Blog ID: ${id}`);

    // Try to find blog by id, blog_id, or _id
    let blog = await blogsCollection.findOne({ id: id });

    if (!blog) {
      // Try by blog_id
      blog = await blogsCollection.findOne({ blog_id: id });
    }

    if (!blog && ObjectId.isValid(id)) {
      // Try by MongoDB _id
      try {
        blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
      } catch (e) {
        // Invalid ObjectId format
        console.log(`📋 Invalid ObjectId format: ${id}`);
      }
    }

    if (!blog) {
      console.log(`❌ Blog not found: ${id}`);
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy bài viết",
        error: "Blog not found",
      });
    }

    // Delete blog
    const result = await blogsCollection.deleteOne({ _id: blog._id });

    if (result.deletedCount === 0) {
      console.log(`❌ Failed to delete blog: ${id}`);
      return res.status(500).json({
        success: false,
        message: "Không thể xóa bài viết",
        error: "Failed to delete blog",
      });
    }

    console.log(
      `✅ Blog deleted successfully: ${blog.id || blog.blog_id || id}`
    );

    // Tự động đồng bộ blogs về JSON sau khi xóa
    syncBlogsToJsonAsync(blogsCollection);

    res.json({
      success: true,
      message: "Xóa bài viết thành công",
      deletedBlog: {
        _id: blog._id,
        id: blog.id || blog.blog_id,
        title: blog.title,
      },
    });
  } catch (error) {
    console.error("❌ Error deleting blog:", error);
    res.status(500).json({
      success: false,
      message: "Lỗi khi xóa bài viết",
      error: error.message,
    });
  }
});

// ============================================================================
// ORDER DETAILS ENDPOINTS
// ============================================================================

/**
 * GET all order details
 */
app.get("/api/orderdetails", checkMongoConnection, async (req, res) => {
  try {
    const orderDetails = await orderDetailsCollection.find({}).toArray();
    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

/**
 * GET order detail by order ID
 */
app.get(
  "/api/orderdetails/:orderId",
  checkMongoConnection,
  async (req, res) => {
    try {
      const orderId = parseInt(req.params.orderId);
      const orderDetail = await orderDetailsCollection.findOne({
        order_id: orderId,
      });

      if (!orderDetail) {
        return res.status(404).json({ error: "Order detail not found" });
      }

      res.json(orderDetail);
    } catch (error) {
      console.error("Error fetching order detail:", error);
      res.status(500).json({ error: "Failed to fetch order detail" });
    }
  }
);

// ============================================================================
// ADDRESS ENDPOINTS
// ============================================================================

/**
 * GET all provinces
 */
app.get("/api/provinces", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (!isMongoConnected || !provincesCollection) {
      console.warn("⚠️ MongoDB not connected, returning empty array");
      return res.json([]);
    }

    const provinces = await provincesCollection.find({}).toArray();
    console.log(`✅ Fetched ${provinces.length} provinces from MongoDB`);
    if (provinces.length === 0) {
      console.warn("⚠️ Provinces collection is empty!");
    }
    res.json(provinces);
  } catch (error) {
    console.error("❌ Error fetching provinces:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch provinces", details: error.message });
  }
});

/**
 * GET all wards
 */
app.get("/api/wards", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (!isMongoConnected || !wardsCollection) {
      console.warn("⚠️ MongoDB not connected, returning empty array");
      return res.json([]);
    }

    const wards = await wardsCollection.find({}).toArray();
    console.log(`✅ Fetched ${wards.length} wards from MongoDB`);
    if (wards.length === 0) {
      console.warn("⚠️ Wards collection is empty!");
    }
    res.json(wards);
  } catch (error) {
    console.error("❌ Error fetching wards:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch wards", details: error.message });
  }
});

/**
 * GET tree (hierarchical address structure)
 */
app.get("/api/tree", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (!isMongoConnected || !treeCollection) {
      console.warn("⚠️ MongoDB not connected, returning empty array");
      return res.json([]);
    }

    const tree = await treeCollection.find({}).toArray();
    console.log(
      `✅ Fetched ${tree.length} provinces from MongoDB tree collection`
    );
    if (tree.length === 0) {
      console.warn("⚠️ Tree collection is empty!");
    }
    res.json(tree);
  } catch (error) {
    console.error("❌ Error fetching tree:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch tree", details: error.message });
  }
});

/**
 * GET tree_complete (complete hierarchical address structure)
 */
app.get("/api/tree_complete", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (!isMongoConnected || !db) {
      console.warn("⚠️ MongoDB not connected, returning empty array");
      return res.json([]);
    }

    // Try to get from tree_complete collection, fallback to tree collection
    let treeCompleteCollection = db.collection("tree_complete");
    let tree = await treeCompleteCollection.find({}).toArray();

    // If tree_complete collection is empty or doesn't exist, try tree collection
    if (!tree || tree.length === 0) {
      console.log(
        "⚠️ tree_complete collection empty, trying tree collection..."
      );
      treeCompleteCollection = db.collection("tree");
      tree = await treeCompleteCollection.find({}).toArray();
    }

    console.log(
      `✅ Fetched ${tree.length} documents from MongoDB tree_complete/tree collection`
    );
    if (tree.length === 0) {
      console.warn("⚠️ Tree collection is empty!");
    }
    res.json(tree);
  } catch (error) {
    console.error("❌ Error fetching tree_complete:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch tree_complete", details: error.message });
  }
});

// ============================================================================
// AUTH ROUTES (Authentication & User Management)
// ============================================================================

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

// ============================================================================
// ADDRESS ROUTES (User Address Management)
// ============================================================================

const addressRoutes = require("./routes/address");
app.use("/api/address", addressRoutes);

// ============================================================================
// PROMOTIONS ENDPOINTS
// ============================================================================

const promotionsRoutes = require("./routes/promotions");
app.use("/api/promotions", promotionsRoutes);

// ============================================================================
// PROMOTION TARGETS ENDPOINTS
// ============================================================================

const promotionTargetsRoutes = require("./routes/promotion-targets");
app.use("/api/promotion-targets", promotionTargetsRoutes);

// ============================================================================
// REVIEWS ENDPOINTS
// ============================================================================

const reviewsRoutes = require("./routes/reviews");
app.use("/api/reviews", reviewsRoutes);

// ============================================================================
// CART ENDPOINTS
// ============================================================================

const cartRoutes = require("./routes/cart");
app.use("/api/cart", cartRoutes);

// Wishlist routes
const wishlistRoutes = require("./routes/wishlist");
app.use("/api/wishlist", wishlistRoutes);

// Chat routes (với AI)
const chatRoutes = require("./routes/chat");
app.use("/api/chat", chatRoutes);

// Consultation routes (Tư vấn sản phẩm)
const consultationsRoutes = require("./routes/consultations");
const contactRoutes = require("./routes/contact");
app.use("/api/consultations", consultationsRoutes);
app.use("/api/contact", contactRoutes);

// ============================================================================
// NOTIFICATION ENDPOINTS
// ============================================================================

/**
 * Helper function: Create order status notification for user
 */
async function createOrderStatusNotification(
  customerId,
  orderId,
  status,
  orderTotal
) {
  if (!notificationsCollection || !customerId || !orderId) {
    return;
  }

  let notificationType = "order";
  let title = "";
  let message = "";

  switch (status) {
    case "pending":
      title = "Đơn hàng đã được tạo thành công";
      message = `Đơn hàng #${orderId} của bạn đã được tạo thành công. Chúng tôi sẽ xác nhận đơn hàng trong thời gian sớm nhất.`;
      break;
    case "confirmed":
      title = "Đơn hàng đã được xác nhận";
      message = `Đơn hàng #${orderId} của bạn đã được xác nhận và đang được chuẩn bị.`;
      break;
    case "processing":
      title = "Đơn hàng đang được xử lý";
      message = `Đơn hàng #${orderId} đang được xử lý và sẽ được giao trong thời gian sớm nhất.`;
      break;
    case "shipping":
      title = "Đơn hàng đang được giao";
      message = `Đơn hàng #${orderId} đang trên đường giao đến bạn. Vui lòng chuẩn bị sẵn sàng nhận hàng.`;
      break;
    case "delivered":
    case "completed":
      title = "Đơn hàng đã giao thành công";
      message = `Đơn hàng #${orderId} đã được giao thành công. Cảm ơn bạn đã tin tưởng VGreen! Hãy đánh giá sản phẩm để nhận được nhiều ưu đãi hơn.`;
      break;
    case "cancelled":
      title = "Đơn hàng đã bị hủy";
      message = `Đơn hàng #${orderId} đã bị hủy. Nếu bạn có thắc mắc, vui lòng liên hệ với chúng tôi.`;
      break;
    case "processing_return":
      title = "Yêu cầu trả hàng đang được xử lý";
      message = `Yêu cầu trả hàng cho đơn hàng #${orderId} đang được xử lý. Chúng tôi sẽ liên hệ với bạn trong thời gian sớm nhất.`;
      break;
    case "returning":
      title = "Đơn hàng đang được trả";
      message = `Đơn hàng #${orderId} đang trong quá trình trả hàng. Vui lòng chuẩn bị hàng hóa để hoàn trả.`;
      break;
    case "returned":
      title = "Đơn hàng đã được trả thành công";
      message = `Đơn hàng #${orderId} đã được trả thành công. Chúng tôi sẽ xử lý hoàn tiền trong thời gian sớm nhất.`;
      break;
    default:
      return; // Don't create notification for other statuses
  }

  try {
    await notificationsCollection.insertOne({
      type: notificationType,
      customerId: customerId,
      orderId: orderId,
      orderTotal: orderTotal,
      title: title,
      message: message,
      status: "active",
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // console.log(
    //   `✅ [Notifications] Created ${status} notification for order ${orderId}, customer ${customerId}`
    // );
  } catch (error) {
    console.error(
      `❌ [Notifications] Error creating notification for order ${orderId}:`,
      error
    );
    throw error;
  }
}

/**
 * Helper function: Create admin notification
 */
async function createAdminNotification(
  type,
  orderId,
  customerId,
  orderTotal,
  options = {}
) {
  if (!notificationsCollection || !orderId) {
    return;
  }

  const title = options.title || "Thông báo mới";
  const message = options.message || "";

  try {
    await notificationsCollection.insertOne({
      type: type,
      orderId: orderId,
      customerId: customerId || "",
      orderTotal: orderTotal || 0,
      title: title,
      message: message,
      status: "active",
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // console.log(
    //   `✅ [Notifications] Created admin ${type} notification for order ${orderId}`
    // );
  } catch (error) {
    console.error(
      `❌ [Notifications] Error creating admin notification for order ${orderId}:`,
      error
    );
    throw error;
  }
}

/**
 * Helper function: Create promotion notification for all users
 */
async function createPromotionNotificationForAllUsers(promotion) {
  if (!notificationsCollection || !usersCollection || !promotion) {
    // console.warn(
    //   "⚠️ [Notifications] Cannot create promotion notifications: missing collections or promotion data"
    // );
    return;
  }

  try {
    // Get all users (only CustomerID is needed)
    const users = await usersCollection
      .find({}, { projection: { CustomerID: 1 } })
      .toArray();

    if (users.length === 0) {
      // console.log(
      //   "⚠️ [Notifications] No users found, skipping promotion notification"
      // );
      return;
    }

    // console.log(
    //   `📢 [Notifications] Creating promotion notification for ${users.length} users...`
    // );

    // Format promotion details for message
    const discountText =
      promotion.discount_type === "percent"
        ? `${promotion.discount_value}%`
        : `${promotion.discount_value.toLocaleString("vi-VN")}₫`;

    const minOrderText =
      promotion.min_order_value > 0
        ? ` (Áp dụng cho đơn hàng từ ${promotion.min_order_value.toLocaleString(
          "vi-VN"
        )}₫)`
        : "";

    const endDateText = promotion.end_date
      ? new Date(promotion.end_date).toLocaleDateString("vi-VN")
      : "";

    const title = "🎉 Khuyến mãi mới từ VGreen!";
    const message = `Mã khuyến mãi "${promotion.code}" - ${promotion.name
      }: Giảm ${discountText}${minOrderText}${endDateText ? `. Hết hạn: ${endDateText}` : ""
      }. Nhanh tay sử dụng ngay!`;

    // Create notifications for all users
    const notifications = users.map((user) => ({
      type: "promotion",
      customerId: user.CustomerID,
      promotionId: promotion.promotion_id || promotion._id?.toString() || "",
      promotionCode: promotion.code || "",
      title: title,
      message: message,
      status: "active",
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Insert all notifications in batch
    if (notifications.length > 0) {
      await notificationsCollection.insertMany(notifications);
      // console.log(
      //   `✅ [Notifications] Created promotion notification for ${notifications.length} users`
      // );
      // console.log(
      //   `📢 [Notifications] Promotion: ${promotion.code} - ${promotion.name}`
      // );
    }
  } catch (error) {
    console.error(
      "❌ [Notifications] Error creating promotion notifications for all users:",
      error
    );
    // Don't throw error, just log it so promotion creation doesn't fail
  }
}

/**
 * GET /api/notifications - Get all notifications (for admin) or user notifications (if customerId provided)
 */
app.get("/api/notifications", checkMongoConnection, async (req, res) => {
  try {
    const { type, status, read, customerId } = req.query;

    const query = {};

    // If customerId is provided, filter by customerId (for user notifications)
    // If not, return all notifications (for admin)
    if (customerId) {
      query.customerId = customerId;
      // User notifications include: order, promotion (but not admin-only types)
      query.type = {
        $nin: [
          "order_cancellation_request",
          "new_order",
          "return_request",
          "system",
        ],
      };
    } else {
      // Admin: show admin notifications (new orders, cancellation requests, return requests, consultation, system)
      query.type = {
        $in: [
          "order_cancellation_request",
          "new_order",
          "return_request",
          "consultation",
          "system",
        ],
      };
    }

    if (type && !customerId) query.type = type; // Only apply type filter for admin
    if (status) query.status = status;
    if (read !== undefined) query.read = read === "true";

    const notifications = await notificationsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      data: notifications,
      count: notifications.length,
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch notifications",
      message: error.message,
    });
  }
});

/**
 * GET /api/notifications/unread-count - Get count of unread notifications (admin or user)
 */
app.get(
  "/api/notifications/unread-count",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { customerId } = req.query;

      const query = { read: false };

      // If customerId is provided, count user notifications
      if (customerId) {
        query.customerId = customerId;
        // User notifications include: order, promotion (but not admin-only types)
        query.type = {
          $nin: [
            "order_cancellation_request",
            "new_order",
            "return_request",
            "system",
          ],
        };
      } else {
        // Admin: count admin notifications (new orders, cancellation requests, return requests, consultation, system)
        query.type = {
          $in: [
            "order_cancellation_request",
            "new_order",
            "return_request",
            "consultation",
            "system",
          ],
        };
      }

      const count = await notificationsCollection.countDocuments(query);
      res.json({
        success: true,
        count: count,
      });
    } catch (error) {
      console.error("❌ Error counting unread notifications:", error);
      res.status(500).json({
        success: false,
        error: "Failed to count notifications",
        message: error.message,
      });
    }
  }
);

/**
 * PUT /api/notifications/:id/read - Mark notification as read
 */
app.put(
  "/api/notifications/:id/read",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await notificationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { read: true, updatedAt: new Date() } }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      res.json({
        success: true,
        message: "Notification marked as read",
      });
    } catch (error) {
      console.error("❌ Error marking notification as read:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update notification",
        message: error.message,
      });
    }
  }
);

/**
 * PUT /api/notifications/:id/status - Update notification status (approve/reject cancellation)
 */
app.put(
  "/api/notifications/:id/status",
  checkMongoConnection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, action } = req.body; // action: 'approve' or 'reject'

      if (!action || !["approve", "reject"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be "approve" or "reject"',
        });
      }

      const notification = await notificationsCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      const newStatus = action === "approve" ? "approved" : "rejected";

      // Update notification
      await notificationsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: newStatus,
            read: true,
            updatedAt: new Date(),
          },
        }
      );

      // If approved and it's a cancellation request, update order status
      if (
        action === "approve" &&
        notification.type === "order_cancellation_request"
      ) {
        try {
          const order = await Order.findOneAndUpdate(
            { OrderID: notification.orderId },
            {
              status: "cancelled",
              updatedAt: new Date(),
            },
            { new: true }
          );

          if (order) {
            // console.log(
            //   `✅ [Notifications] Order ${notification.orderId} cancelled after admin approval`
            // );

            // Create notification for user about cancellation
            try {
              await createOrderStatusNotification(
                notification.customerId,
                notification.orderId,
                "cancelled",
                notification.orderTotal
              );
            } catch (notifError) {
              console.error(
                "❌ Error creating cancellation notification:",
                notifError
              );
            }
          }
        } catch (orderError) {
          console.error("❌ Error updating order status:", orderError);
          // Don't fail the notification update
        }
      }

      res.json({
        success: true,
        message: `Notification ${action === "approve" ? "approved" : "rejected"
          }`,
        data: {
          id: id,
          status: newStatus,
        },
      });
    } catch (error) {
      console.error("❌ Error updating notification status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update notification status",
        message: error.message,
      });
    }
  }
);

// ============================================================================
// ROOT ROUTE - API Information
// ============================================================================

app.get("/", (req, res) => {
  res.json({
    name: "VGreen Backend API",
    version: "1.0.0",
    status: "running",
    environment: process.env.NODE_ENV || "development",
    database: DB_NAME,
    mongodb_connected: isMongoConnected,
    endpoints: {
      base: "/api",
      docs: "See README.md for API documentation",
      health: "/api/health",
      auth: "/api/auth",
      users: "/api/users",
      products: "/api/products",
      orders: "/api/orders",
      promotions: "/api/promotions",
      reviews: "/api/reviews",
      blogs: "/api/blogs"
    }
  });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    mongodb: {
      connected: isMongoConnected,
      database: DB_NAME
    },
    environment: process.env.NODE_ENV || "development"
  });
});

// ============================================================================
// SERVER START
// ============================================================================

// Render cần listen trên 0.0.0.0, không phải localhost
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend API server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${DB_NAME}`);
  console.log(`Access API at: http://0.0.0.0:${PORT}/api`);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");

  if (mongoClient) {
    console.log("📦 Closing MongoDB connection...");
    await mongoClient.close();
    console.log("✅ MongoDB connection closed");
  }

  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM, shutting down gracefully...");

  if (mongoClient) {
    console.log("📦 Closing MongoDB connection...");
    await mongoClient.close();
    console.log("✅ MongoDB connection closed");
  }

  process.exit(0);
});
