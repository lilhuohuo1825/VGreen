const express = require("express");
const router = express.Router();
const {
  Order,
  generateOrderID,
  Promotion,
  PromotionUsage,
  Cart,
  User,
  Product,
} = require("../db");
const backupService = require("../services/backup.service");
const {
  updateUserTotalSpentAndTieringAsync,
} = require("../services/totalspent-tiering.service");

// ========== CREATE ORDER ==========
// POST /api/orders - Tạo đơn hàng mới
router.post("/", async (req, res) => {
  try {
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

    // console.log(" [Orders] Received payment method:", paymentMethod);

    // Validate required fields
    if (!CustomerID || !shippingInfo || !items || items.length === 0) {
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
      return res.status(400).json({
        success: false,
        message: "Missing required shipping information",
      });
    }

    // Generate unique OrderID
    const OrderID = generateOrderID();

    // Initialize routes map for tracking status changes
    const routes = new Map();
    routes.set("pending", new Date());

    // Xử lý items: đảm bảo itemType và originalPrice được set đúng
    console.log(
      `📦 [Orders] Raw items from request:`,
      JSON.stringify(items, null, 2)
    );

    const processedItems = items.map((item, index) => {
      // Log raw item để debug
      console.log(
        `📦 [Orders] Raw item ${index}:`,
        JSON.stringify(
          {
            sku: item.sku,
            productName: item.productName,
            itemType: item.itemType,
            itemTypeType: typeof item.itemType,
            itemTypeValue: item.itemType,
          },
          null,
          2
        )
      );

      // Đảm bảo itemType có giá trị (mặc định là 'purchased')
      // Kiểm tra cả null, undefined, và empty string
      // Ưu tiên giữ nguyên giá trị từ request nếu hợp lệ
      let itemType = item.itemType;

      console.log(
        `📦 [Orders] Processing itemType for item ${index}:`,
        `raw=${item.itemType}`,
        `type=${typeof item.itemType}`,
        `isGifted=${item.itemType === "gifted"}`,
        `isPurchased=${item.itemType === "purchased"}`
      );

      // Nếu itemType không hợp lệ hoặc không có, set mặc định
      if (!itemType || (itemType !== "purchased" && itemType !== "gifted")) {
        console.warn(
          `⚠️ [Orders] Invalid or missing itemType for item ${index}: ${itemType}, defaulting to 'purchased'`
        );
        itemType = "purchased";
      }

      // Đảm bảo originalPrice có giá trị (mặc định là price)
      const originalPrice = item.originalPrice || item.price || 0;

      console.log(
        `📦 [Orders] Final itemType for item ${index}:`,
        itemType,
        `(type: ${typeof itemType})`
      );

      // Đảm bảo itemType luôn có giá trị trước khi tạo processedItem
      if (!itemType || (itemType !== "purchased" && itemType !== "gifted")) {
        console.error(
          `❌ [Orders] ItemType validation failed for item ${index}, forcing to 'purchased'`
        );
        itemType = "purchased";
      }

      const processedItem = {
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
        image: item.image || "",
        unit: item.unit || "",
        category: item.category || "",
        subcategory: item.subcategory || "",
        itemType: itemType, // Đảm bảo itemType luôn có giá trị hợp lệ
        originalPrice: originalPrice,
      };

      // Double check itemType trong processedItem
      if (!processedItem.itemType) {
        console.error(
          `❌ [Orders] processedItem.itemType is missing for item ${index}, setting to 'purchased'`
        );
        processedItem.itemType = "purchased";
      }

      console.log(
        `📦 [Orders] Processed item ${index}:`,
        JSON.stringify(processedItem, null, 2)
      );
      console.log(
        `📦 [Orders] Processed item ${index} itemType:`,
        processedItem.itemType,
        `(type: ${typeof processedItem.itemType})`
      );

      return processedItem;
    });

    console.log(
      `📦 [Orders] All processed items (${processedItems.length}):`,
      JSON.stringify(processedItems, null, 2)
    );

    // Kiểm tra itemType distribution
    const itemTypeCount = {
      purchased: processedItems.filter((i) => i.itemType === "purchased")
        .length,
      gifted: processedItems.filter((i) => i.itemType === "gifted").length,
    };
    console.log(`📦 [Orders] ItemType distribution:`, itemTypeCount);

    // Log processedItems trước khi tạo Order
    console.log(
      `📦 [Orders] ProcessedItems before creating Order:`,
      JSON.stringify(
        processedItems.map((item) => ({
          sku: item.sku,
          productName: item.productName,
          itemType: item.itemType,
          itemTypeType: typeof item.itemType,
        })),
        null,
        2
      )
    );

    // Create new order
    const newOrder = new Order({
      OrderID,
      CustomerID,
      shippingInfo,
      items: processedItems, // Sử dụng processedItems thay vì items
      paymentMethod: paymentMethod || "cod",
      subtotal,
      shippingFee: shippingFee || 0,
      shippingDiscount: shippingDiscount || 0,
      discount: discount || 0,
      vatRate: vatRate || 0,
      vatAmount: vatAmount || 0,
      totalAmount,
      code: code || "",
      promotionName: promotionName || "",
      wantInvoice: wantInvoice || false,
      invoiceInfo: invoiceInfo || {},
      consultantCode: consultantCode || "",
      status: "pending",
      routes: routes,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Log order before save
    console.log(
      `📦 [Orders] Order before save - items:`,
      JSON.stringify(newOrder.items, null, 2)
    );
    console.log(
      `📦 [Orders] Order before save - items itemType:`,
      newOrder.items.map((item) => ({
        sku: item.sku,
        productName: item.productName,
        itemType: item.itemType,
        itemTypeType: typeof item.itemType,
      }))
    );

    // Save to database
    let savedOrder;
    try {
      savedOrder = await newOrder.save();
      console.log(`✅ [Orders] Order saved successfully: ${OrderID}`);
    } catch (saveError) {
      console.error(`❌ [Orders] Error saving order:`, saveError);
      console.error(`❌ [Orders] Error details:`, {
        message: saveError.message,
        name: saveError.name,
        errors: saveError.errors,
      });
      throw saveError;
    }

    // Log order after save to verify itemType was saved
    console.log(
      `📦 [Orders] Order after save - items:`,
      JSON.stringify(savedOrder.items, null, 2)
    );
    console.log(
      `📦 [Orders] Order after save - items itemType:`,
      savedOrder.items.map((item) => ({
        sku: item.sku,
        productName: item.productName,
        itemType: item.itemType,
        itemTypeType: typeof item.itemType,
      }))
    );

    // Verify itemType in saved order
    savedOrder.items.forEach((item, index) => {
      if (!item.itemType) {
        console.error(
          `❌ [Orders] Item ${index} missing itemType after save:`,
          item
        );
      } else {
        console.log(
          `✅ [Orders] Item ${index} has itemType: ${
            item.itemType
          } (type: ${typeof item.itemType})`
        );
      }
    });

    // console.log(` [Orders] Created new order: ${OrderID} for ${CustomerID}`);

    //  Tự động lưu promotion usage nếu có sử dụng mã khuyến mãi
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
          //   ` [PromotionUsage] Saved usage for promotion ${code} - Order ${OrderID}`
          // );
        } else {
          // console.warn(
          //   ` [PromotionUsage] Promotion not found for code: ${code}`
          // );
        }
      } catch (usageError) {
        // Log lỗi nhưng không fail toàn bộ request
        // console.error(
        //   " [PromotionUsage] Error saving promotion usage:",
        //   usageError
        // );
      }
    }

    // Note: Việc xóa items khỏi giỏ hàng sẽ được xử lý ở frontend
    // Frontend chỉ xóa những items đã được đặt hàng, không xóa toàn bộ cart

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: savedOrder, // Return savedOrder để đảm bảo dữ liệu phản ánh đúng database
    });
  } catch (error) {
    // console.error(" [Orders] Error creating order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

// ========== GET ALL ORDERS (by CustomerID) ==========
// GET /api/orders?CustomerID=xxx
router.get("/", async (req, res) => {
  try {
    const { CustomerID } = req.query;

    if (!CustomerID) {
      return res.status(400).json({
        success: false,
        message: "CustomerID is required",
      });
    }

    // Log để debug
    // console.log(` [Orders] Fetching orders for CustomerID: ${CustomerID}`);

    // Kiểm tra và tự động chuyển các đơn hàng delivered sang received sau 24 giờ
    // NOTE: This should NOT affect cancelled orders
    await autoReceiveDeliveredOrders(CustomerID);

    // Kiểm tra và tự động chuyển các đơn hàng received sang completed sau 24 giờ
    // NOTE: This should NOT affect cancelled orders
    await autoCompleteReceivedOrders(CustomerID);

    // Kiểm tra và tự động chuyển các đơn hàng delivered sang completed sau 24h (legacy - giữ lại để tương thích)
    // NOTE: This should NOT affect cancelled orders
    await autoCompleteDeliveredOrders(CustomerID);

    // Get orders, but exclude cancelled orders from auto-complete logic
    // Cancelled orders should never change status
    const orders = await Order.find({ CustomerID }).sort({ createdAt: -1 });

    // Tự động xóa sản phẩm inactive khỏi đơn hàng pending/processing khi load
    const { Product } = require("../db");
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
              console.log(
                `🗑️ [Orders] Removing inactive product ${item.sku} (${
                  item.productName || item.product_name || "N/A"
                }) from order ${order.OrderID}`
              );
            }
            return isActive;
          });

          // Nếu có thay đổi, cập nhật đơn hàng
          if (activeItems.length !== order.items.length) {
            const removedCount = order.items.length - activeItems.length;

            // Nếu không còn sản phẩm nào, xóa đơn hàng
            if (activeItems.length === 0) {
              // Xóa đơn hàng khỏi database
              await Order.findOneAndDelete({ OrderID: order.OrderID });

              // Đánh dấu đơn hàng để loại bỏ khỏi mảng trả về
              order._shouldDelete = true;

              cleanedOrdersCount++;
              console.log(
                `🗑️ [Orders] Deleted order ${order.OrderID}: all products were inactive`
              );
            } else {
              // Tính lại subtotal và totalAmount
              const removedItemTotal = order.items
                .filter((item) => !activeSkus.has(item.sku))
                .reduce(
                  (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
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

              // Cập nhật đơn hàng
              await Order.findOneAndUpdate(
                { OrderID: order.OrderID },
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
              console.log(
                `✅ [Orders] Cleaned order ${order.OrderID}: removed ${removedCount} inactive products. New total: ${newTotalAmount}`
              );
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
        console.log(
          `🗑️ [Orders] Deleted ${deletedCount} empty orders (all products were inactive)`
        );
      }
      console.log(
        `✅ [Orders] Cleaned ${cleanedOrdersCount} orders: removed inactive products`
      );
    }

    // Log order statuses for debugging
    const statusCounts = {};
    validOrders.forEach((order) => {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    });
    console.log(
      `📦 [Orders] Loaded ${validOrders.length} orders for CustomerID ${CustomerID}:`,
      statusCounts
    );

    // Verify cancelled orders are preserved
    const cancelledOrders = validOrders.filter((o) => o.status === "cancelled");
    if (cancelledOrders.length > 0) {
      console.log(
        `✅ [Orders] Found ${cancelledOrders.length} cancelled orders:`,
        cancelledOrders.map((o) => o.OrderID)
      );
    }

    res.json({
      success: true,
      data: validOrders,
      count: validOrders.length,
    });
  } catch (error) {
    // console.error(" [Orders] Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

// Helper function: Tự động chuyển các đơn hàng delivered sang received (nếu đã quá 24 giờ)
async function autoReceiveDeliveredOrders(customerID) {
  try {
    const now = new Date();
    // Production: 24 giờ (24 * 60 * 60 * 1000 = 86400000 ms)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 giờ

    // Tìm các đơn hàng delivered để chuyển thành received
    const deliveredOrders = await Order.find({
      CustomerID: customerID,
      status: "delivered",
    });

    // Lọc các đơn hàng đã delivered trước 24 giờ (check trong routes.delivered)
    const ordersToReceive = deliveredOrders.filter((order) => {
      let routes = order.routes || {};
      // Convert Map to Object if needed
      if (routes instanceof Map) {
        routes = Object.fromEntries(routes);
      }

      const deliveredDate = routes.delivered || routes["delivered"];
      if (!deliveredDate) {
        // Nếu không có delivered date trong routes, fallback to updatedAt
        const updatedAt = order.updatedAt || order.UpdatedAt;
        if (updatedAt) {
          const updatedAtDate =
            updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
          return updatedAtDate <= twentyFourHoursAgo;
        }
        return false;
      }
      // Convert to Date if it's a string or object
      const deliveredDateObj =
        deliveredDate instanceof Date ? deliveredDate : new Date(deliveredDate);
      return deliveredDateObj <= twentyFourHoursAgo;
    });

    if (ordersToReceive.length === 0) {
      return; // Không có đơn hàng nào cần chuyển
    }

    console.log(
      `📦 [Orders] Found ${ordersToReceive.length} delivered orders older than 24 hours, auto-receiving...`
    );

    for (const order of ordersToReceive) {
      // Initialize routes if it doesn't exist
      let routes = order.routes || {};
      // Convert Map to Object if needed
      if (routes instanceof Map) {
        routes = Object.fromEntries(routes);
      }

      // Chỉ chuyển nếu chưa có received timestamp
      if (!routes.received && !routes["received"]) {
        routes.received = new Date();
        // Keep delivered timestamp for history
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
          `✅ [Orders] Auto-received order ${order.OrderID}: delivered → received`
        );
      } else {
        console.log(
          `⚠️ [Orders] Order ${order.OrderID} already has received timestamp, skipping`
        );
      }
    }
  } catch (error) {
    console.error("❌ [Orders] Error auto-receiving delivered orders:", error);
  }
}

// Helper function: Tự động chuyển các đơn hàng received sang completed (nếu đã quá 24 giờ) - cho tất cả customers
async function autoCompleteReceivedOrdersAll() {
  try {
    const now = new Date();
    // Production: 24 giờ (24 * 60 * 60 * 1000 = 86400000 ms)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 giờ

    // Tìm TẤT CẢ các đơn hàng received để chuyển thành completed (không filter theo customerID)
    const receivedOrders = await Order.find({
      status: "received",
    });

    // Lọc các đơn hàng đã received trước 24 giờ (check trong routes.received)
    const ordersToComplete = receivedOrders.filter((order) => {
      let routes = order.routes || {};
      // Convert Map to Object if needed
      if (routes instanceof Map) {
        routes = Object.fromEntries(routes);
      }

      const receivedDate = routes.received || routes["received"];
      if (!receivedDate) {
        // Nếu không có received date trong routes, fallback to updatedAt
        const updatedAt = order.updatedAt || order.UpdatedAt;
        if (updatedAt) {
          const updatedAtDate =
            updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
          return updatedAtDate <= twentyFourHoursAgo;
        }
        return false;
      }
      // Convert to Date if it's a string or object
      const receivedDateObj =
        receivedDate instanceof Date ? receivedDate : new Date(receivedDate);
      return receivedDateObj <= twentyFourHoursAgo;
    });

    if (ordersToComplete.length === 0) {
      return; // Không có đơn hàng nào cần chuyển
    }

    console.log(
      `📦 [Orders] Found ${ordersToComplete.length} received orders older than 24 hours, auto-completing...`
    );

    for (const order of ordersToComplete) {
      // Initialize routes if it doesn't exist
      let routes = order.routes || {};
      // Convert Map to Object if needed
      if (routes instanceof Map) {
        routes = Object.fromEntries(routes);
      }

      // Chỉ chuyển nếu chưa có completed timestamp
      if (!routes.completed && !routes["completed"]) {
        routes.completed = new Date();
        // Keep received timestamp for history
        if (!routes.received && !routes["received"]) {
          const updatedAt = order.updatedAt || order.UpdatedAt;
          routes.received = updatedAt || new Date();
        }

        const updatedOrder = await Order.findOneAndUpdate(
          { OrderID: order.OrderID },
          { status: "completed", routes: routes, updatedAt: new Date() },
          { new: true, runValidators: true }
        );

        if (updatedOrder) {
          console.log(
            `✅ [Orders] Auto-completed order ${order.OrderID}: received → completed`
          );

          // Tăng purchase_count cho tất cả sản phẩm trong order (1 lượt per order, not per quantity)
          try {
            const { Product } = require("../db");
            // Group items by SKU to ensure each product only gets +1 per order
            const uniqueSKUs = new Set();
            for (const item of updatedOrder.items || order.items || []) {
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
              "❌ [Orders] Error updating product purchase_count:",
              productError
            );
          }
        }
      } else {
        console.log(
          `⚠️ [Orders] Order ${order.OrderID} already has completed timestamp, skipping`
        );
      }
    }
  } catch (error) {
    console.error("❌ [Orders] Error auto-completing received orders:", error);
  }
}

// Helper function: Tự động chuyển các đơn hàng received sang completed (nếu đã quá 24 giờ) - cho một customer cụ thể
async function autoCompleteReceivedOrders(customerID) {
  try {
    const now = new Date();
    // Production: 24 giờ (24 * 60 * 60 * 1000 = 86400000 ms)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 giờ

    // Tìm các đơn hàng received để chuyển thành completed
    const receivedOrders = await Order.find({
      CustomerID: customerID,
      status: "received",
    });

    // Lọc các đơn hàng đã received trước 24 giờ (check trong routes.received)
    const ordersToComplete = receivedOrders.filter((order) => {
      let routes = order.routes || {};
      // Convert Map to Object if needed
      if (routes instanceof Map) {
        routes = Object.fromEntries(routes);
      }

      const receivedDate = routes.received || routes["received"];
      if (!receivedDate) {
        // Nếu không có received date trong routes, fallback to updatedAt
        const updatedAt = order.updatedAt || order.UpdatedAt;
        if (updatedAt) {
          const updatedAtDate =
            updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
          return updatedAtDate <= twentyFourHoursAgo;
        }
        return false;
      }
      // Convert to Date if it's a string or object
      const receivedDateObj =
        receivedDate instanceof Date ? receivedDate : new Date(receivedDate);
      return receivedDateObj <= twentyFourHoursAgo;
    });

    if (ordersToComplete.length === 0) {
      return; // Không có đơn hàng nào cần chuyển
    }

    console.log(
      `📦 [Orders] Found ${ordersToComplete.length} received orders older than 24 hours, auto-completing...`
    );

    for (const order of ordersToComplete) {
      // Initialize routes if it doesn't exist
      let routes = order.routes || {};
      // Convert Map to Object if needed
      if (routes instanceof Map) {
        routes = Object.fromEntries(routes);
      }

      // Chỉ chuyển nếu chưa có completed timestamp
      if (!routes.completed && !routes["completed"]) {
        routes.completed = new Date();
        // Keep received timestamp for history
        if (!routes.received && !routes["received"]) {
          const updatedAt = order.updatedAt || order.UpdatedAt;
          routes.received = updatedAt || new Date();
        }

        const updatedOrder = await Order.findOneAndUpdate(
          { OrderID: order.OrderID },
          { status: "completed", routes: routes, updatedAt: new Date() },
          { new: true, runValidators: true }
        );

        if (updatedOrder) {
          console.log(
            `✅ [Orders] Auto-completed order ${order.OrderID}: received → completed`
          );

          // Tăng purchase_count cho tất cả sản phẩm trong order (1 lượt per order, not per quantity)
          try {
            const { Product } = require("../db");
            // Group items by SKU to ensure each product only gets +1 per order
            const uniqueSKUs = new Set();
            for (const item of updatedOrder.items || order.items || []) {
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
              "❌ [Orders] Error updating product purchase_count:",
              productError
            );
          }
        }
      } else {
        console.log(
          `⚠️ [Orders] Order ${order.OrderID} already has completed timestamp, skipping`
        );
      }
    }
  } catch (error) {
    console.error("❌ [Orders] Error auto-completing received orders:", error);
  }
}

// Helper function: Tự động chuyển các đơn hàng delivered sang completed (thống nhất status)
async function autoCompleteDeliveredOrders(customerID) {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Tìm các đơn hàng delivered để chuyển thành completed
    const deliveredOrders = await Order.find({
      CustomerID: customerID,
      status: "delivered",
    });

    // Lọc các đơn hàng đã delivered trước 24h (check trong routes.delivered)
    const ordersToComplete = deliveredOrders.filter((order) => {
      const routes = order.routes || new Map();
      const deliveredDate = routes.get("delivered");
      if (!deliveredDate) {
        // Nếu không có delivered date trong routes, fallback to updatedAt
        return order.updatedAt && order.updatedAt <= twentyFourHoursAgo;
      }
      return deliveredDate <= twentyFourHoursAgo;
    });

    if (ordersToComplete.length === 0) {
      return; // Không có đơn hàng nào cần chuyển
    }

    // console.log(
    //   ` [Orders] Found ${ordersToComplete.length} delivered orders older than 24h, auto-completing...`
    // );

    for (const order of ordersToComplete) {
      // Initialize routes if it doesn't exist
      const routes = order.routes || new Map();
      routes.set("completed", new Date());
      // Keep delivered timestamp for history
      if (!routes.has("delivered")) {
        routes.set("delivered", new Date());
      }

      await Order.findOneAndUpdate(
        { OrderID: order.OrderID },
        { status: "completed", routes, updatedAt: new Date() },
        { new: true }
      );

      // console.log(
      //   ` [Orders] Auto-completed order ${order.OrderID} (delivered for more than 24h)`
      // );

      // Tăng purchase_count cho tất cả sản phẩm trong order (1 lượt per order, not per quantity)
      try {
        // Group items by SKU to ensure each product only gets +1 per order
        const uniqueSKUs = new Set();
        for (const item of order.items) {
          if (item.sku && !uniqueSKUs.has(item.sku)) {
            uniqueSKUs.add(item.sku);
            await Product.findOneAndUpdate(
              { sku: item.sku },
              { $inc: { purchase_count: 1 } },
              { new: true }
            );
            // console.log(
            //   ` [Orders] Incremented purchase_count for SKU: ${item.sku} by 1 (auto-complete)`
            // );
          }
        }

        // Update customer TotalSpent and CustomerTiering
        // Sử dụng service để tính lại từ tất cả orders đã completed
        const {
          updateUserTotalSpentAndTieringAsync,
        } = require("../services/totalspent-tiering.service");
        updateUserTotalSpentAndTieringAsync(User, Order, order.CustomerID);
      } catch (updateError) {
        // console.error(
        //   ` [Orders] Error updating product/customer stats for auto-completed order ${order.OrderID}:`,
        //   updateError
        // );
        // Continue with next order even if update fails
      }
    }
  } catch (error) {
    // console.error(" [Orders] Error auto-completing delivered orders:", error);
    // Don't throw error, just log it
  }
}

// ========== GET ORDER BY ID ==========
// GET /api/orders/:orderId
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ OrderID: orderId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    // console.error(" [Orders] Error fetching order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order",
      error: error.message,
    });
  }
});

// ========== UPDATE ORDER ==========
// PUT /api/orders/:orderId - Update order (full or partial)
router.put("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderData = req.body;

    // Check if order exists
    const existingOrder = await Order.findOne({ OrderID: orderId });
    if (!existingOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // If only CustomerID is being updated (partial update), allow it
    if (Object.keys(orderData).length === 1 && orderData.CustomerID) {
      const updatedOrder = await Order.findOneAndUpdate(
        { OrderID: orderId },
        {
          CustomerID: orderData.CustomerID,
          updatedAt: new Date(),
        },
        { new: true }
      );

      console.log(
        `✅ [Orders] Updated order ${orderId} CustomerID to ${orderData.CustomerID}`
      );

      return res.json({
        success: true,
        message: "Order CustomerID updated successfully",
        data: updatedOrder,
      });
    }

    // Full order update
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

    // Prepare update data
    const updateData = {
      CustomerID: orderData.CustomerID,
      shippingInfo: orderData.shippingInfo,
      items: orderData.items.map((item) => ({
        sku: String(item.sku || ""),
        name: String(item.name || ""),
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
        image: Array.isArray(item.image)
          ? String(item.image[0] || "")
          : String(item.image || ""),
        unit: String(item.unit || ""),
        category: String(item.category || ""),
        subcategory: String(item.subcategory || ""),
      })),
      paymentMethod: orderData.paymentMethod || "cod",
      subtotal: Number(orderData.subtotal || 0),
      shippingFee: Number(orderData.shippingFee || 0),
      shippingDiscount: Number(orderData.shippingDiscount || 0),
      discount: Number(orderData.discount || 0),
      vatRate: Number(orderData.vatRate || 0),
      vatAmount: Number(orderData.vatAmount || 0),
      totalAmount: Number(orderData.totalAmount || 0),
      code: orderData.code || "",
      promotionName: orderData.promotionName || "",
      wantInvoice: orderData.wantInvoice || false,
      invoiceInfo: orderData.invoiceInfo || {},
      consultantCode: orderData.consultantCode || "",
      updatedAt: new Date(),
    };

    // Update status if provided
    if (orderData.status) {
      updateData.status = orderData.status;

      // Update routes if status changed
      const routes = existingOrder.routes || new Map();
      if (!routes.has(orderData.status)) {
        routes.set(orderData.status, new Date());
      }
      updateData.routes = routes;
    }

    // Update order
    const updatedOrder = await Order.findOneAndUpdate(
      { OrderID: orderId },
      { $set: updateData },
      { new: true }
    );

    console.log(`✅ [Orders] Updated order ${orderId}`);

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

// ========== UPDATE ORDER STATUS ==========
// PUT /api/orders/:orderId/status
router.put("/:orderId/status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

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
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Get the current order to update routes
    const currentOrder = await Order.findOne({ OrderID: orderId });
    if (!currentOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Initialize routes map from existing order or create new one
    // Convert Map to Object for MongoDB storage if it's a Map
    let routesObj = {};
    if (currentOrder.routes) {
      if (currentOrder.routes instanceof Map) {
        // Convert Map to plain object
        currentOrder.routes.forEach((value, key) => {
          routesObj[key] = value;
        });
      } else if (typeof currentOrder.routes === "object") {
        // Already an object, use it directly
        routesObj = { ...currentOrder.routes };
      }
    }

    // If order status is "delivered", automatically convert to "completed" (unified status)
    // Đã comment: Giữ nguyên status "delivered" thay vì tự động chuyển thành "completed"
    // Both "delivered" and "completed" are considered the same final status
    let finalStatus = status;
    // if (status === "delivered") {
    //   finalStatus = "completed";
    //   routesObj["completed"] = new Date();
    //   // Keep delivered timestamp for history
    //   if (!routesObj["delivered"]) {
    //     routesObj["delivered"] = new Date();
    //   }
    // } else {
    //   routesObj[status] = new Date();
    // }

    // Update routes with new status (giữ nguyên status được gửi lên)
    routesObj[status] = new Date();

    // Prepare update data - explicitly set status and routes
    const updateData = {
      status: finalStatus,
      routes: routesObj,
      updatedAt: new Date(),
    };

    // If reason is provided (for cancellation), save it
    if (req.body.reason) {
      updateData.cancelReason = req.body.reason;
    }

    // Log the update attempt
    console.log(
      `📦 [Orders] Updating order ${orderId} status from "${currentOrder.status}" to "${finalStatus}"`
    );
    console.log(`📦 [Orders] Current order status: "${currentOrder.status}"`);
    console.log(`📦 [Orders] Requested status: "${status}"`);
    console.log(`📦 [Orders] Final status: "${finalStatus}"`);
    console.log(
      `📦 [Orders] Routes object:`,
      JSON.stringify(routesObj, null, 2)
    );
    if (req.body.reason) {
      console.log(`📦 [Orders] Cancel reason: ${req.body.reason}`);
    }

    // Use findOneAndUpdate with explicit status update
    const order = await Order.findOneAndUpdate(
      { OrderID: orderId },
      {
        $set: {
          status: finalStatus,
          routes: routesObj,
          updatedAt: new Date(),
          ...(req.body.reason ? { cancelReason: req.body.reason } : {}),
        },
      },
      { new: true, runValidators: true }
    );

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
    console.log(`✅ [Orders] Successfully updated order ${orderId}`);
    console.log(`✅ [Orders] Verified status in DB: "${verifiedOrder.status}"`);
    console.log(`✅ [Orders] Order object status: "${order.status}"`);
    if (verifiedOrder.cancelReason) {
      console.log(
        `✅ [Orders] Cancel reason saved: ${verifiedOrder.cancelReason}`
      );
    }

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

      console.log(
        `⏰ [Orders] Scheduling automatic status change: confirmed → shipping after ${delaySeconds} seconds for order ${orderId}`
      );
      console.log(`   📅 Start time: ${startTime.toLocaleString("vi-VN")}`);
      console.log(`   🎯 Target time: ${targetTime.toLocaleString("vi-VN")}`);

      // Countdown timer - log every 10 seconds (vì delay chỉ 30 giây)
      let countdownInterval = setInterval(() => {
        const now = new Date();
        const remaining = targetTime.getTime() - now.getTime();

        if (remaining <= 0) {
          clearInterval(countdownInterval);
          return;
        }

        const remainingSeconds = Math.floor(remaining / 1000);

        console.log(
          `   ⏳ [Countdown] Order ${orderId}: Còn ${remainingSeconds} giây để chuyển sang shipping...`
        );
      }, 10 * 1000); // Log every 10 seconds

      setTimeout(async () => {
        clearInterval(countdownInterval); // Clear countdown when timeout fires
        try {
          // Kiểm tra lại order để đảm bảo vẫn còn status "confirmed" (chưa bị thay đổi)
          const currentOrder = await Order.findOne({ OrderID: orderId });
          if (currentOrder && currentOrder.status === "confirmed") {
            console.log(
              `🚚 [Orders] Auto-updating order ${orderId} from confirmed → shipping`
            );

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
            console.log(
              `✅ [Orders] Successfully auto-updated order ${orderId} to shipping status at ${updateTime.toLocaleString(
                "vi-VN"
              )}`
            );
            console.log(
              `   ⏱️ Total time elapsed: ${Math.round(
                (updateTime.getTime() - startTime.getTime()) / 1000
              )} seconds`
            );
          } else {
            console.log(
              `⚠️ [Orders] Order ${orderId} status changed before auto-update, skipping shipping transition`
            );
          }
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

      console.log(
        `⏰ [Orders] Scheduling automatic status change: delivered → received after ${delayMinutes} minutes for order ${orderId}`
      );
      console.log(`   📅 Start time: ${startTime.toLocaleString("vi-VN")}`);
      console.log(`   🎯 Target time: ${targetTime.toLocaleString("vi-VN")}`);

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

        console.log(
          `   ⏳ [Countdown] Order ${orderId}: Còn ${remainingMinutes} phút ${remainingSeconds} giây để chuyển sang received...`
        );
      }, 30 * 1000); // Log every 30 seconds

      setTimeout(async () => {
        clearInterval(countdownInterval); // Clear countdown when timeout fires
        try {
          // Kiểm tra lại order để đảm bảo vẫn còn status "delivered" (chưa bị thay đổi bởi user)
          const currentOrder = await Order.findOne({ OrderID: orderId });
          if (currentOrder && currentOrder.status === "delivered") {
            console.log(
              `📦 [Orders] Auto-updating order ${orderId} from delivered → received`
            );

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
            console.log(
              `✅ [Orders] Successfully auto-updated order ${orderId} to received status at ${updateTime.toLocaleString(
                "vi-VN"
              )}`
            );
            console.log(
              `   ⏱️ Total time elapsed: ${Math.round(
                (updateTime.getTime() - startTime.getTime()) / 1000
              )} seconds`
            );
          } else {
            console.log(
              `⚠️ [Orders] Order ${orderId} status changed before auto-update, skipping received transition`
            );
          }
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

      console.log(
        `⏰ [Orders] Scheduling automatic status change: received → completed after ${delayMinutes} minutes for order ${orderId}`
      );
      console.log(`   📅 Start time: ${startTime.toLocaleString("vi-VN")}`);
      console.log(`   🎯 Target time: ${targetTime.toLocaleString("vi-VN")}`);

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

        console.log(
          `   ⏳ [Countdown] Order ${orderId}: Còn ${remainingMinutes} phút ${remainingSeconds} giây để chuyển sang completed...`
        );
      }, 30 * 1000); // Log every 30 seconds

      setTimeout(async () => {
        clearInterval(countdownInterval); // Clear countdown when timeout fires
        try {
          // Kiểm tra lại order để đảm bảo vẫn còn status "received" (chưa bị thay đổi bởi user review hoặc cancel return)
          const currentOrder = await Order.findOne({ OrderID: orderId });
          if (currentOrder && currentOrder.status === "received") {
            console.log(
              `✅ [Orders] Auto-updating order ${orderId} from received → completed`
            );

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
            console.log(
              `✅ [Orders] Successfully auto-updated order ${orderId} to completed status at ${updateTime.toLocaleString(
                "vi-VN"
              )}`
            );
            console.log(
              `   ⏱️ Total time elapsed: ${Math.round(
                (updateTime.getTime() - startTime.getTime()) / 1000
              )} seconds`
            );
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

    // Giảm tồn kho khi đơn hàng được xác nhận (confirmed/processing)
    // Chỉ giảm khi chuyển từ pending sang confirmed/processing (chưa giảm trước đó)
    if (
      (finalStatus === "confirmed" || finalStatus === "processing") &&
      (previousStatus === "pending" || !previousStatus)
    ) {
      try {
        console.log(
          `📦 [Stock] Reducing stock for order ${orderId} (status: ${previousStatus} -> ${finalStatus})`
        );

        for (const item of verifiedOrder.items) {
          if (item.sku && item.quantity && item.quantity > 0) {
            // Sử dụng $inc để tránh race condition và đảm bảo atomic operation
            const updateResult = await Product.findOneAndUpdate(
              { sku: item.sku, stock: { $gte: item.quantity } }, // Chỉ giảm nếu stock đủ
              { $inc: { stock: -item.quantity } }, // Giảm stock
              { new: true }
            );

            if (updateResult) {
              console.log(
                `✅ [Stock] Reduced stock for SKU ${item.sku}: ${
                  updateResult.stock + item.quantity
                } -> ${updateResult.stock} (quantity: ${item.quantity})`
              );
            } else {
              // Nếu stock không đủ, vẫn giảm nhưng log warning
              const product = await Product.findOne({ sku: item.sku });
              if (product) {
                const currentStock = product.stock || 0;
                const newStock = Math.max(0, currentStock - item.quantity);
                await Product.findOneAndUpdate(
                  { sku: item.sku },
                  { $set: { stock: newStock } },
                  { new: true }
                );
                console.warn(
                  `⚠️ [Stock] Stock insufficient for SKU ${item.sku}: ${currentStock} -> ${newStock} (requested: ${item.quantity})`
                );
              } else {
                console.warn(
                  `⚠️ [Stock] Product not found for SKU: ${item.sku}`
                );
              }
            }
          }
        }
      } catch (stockError) {
        console.error(
          `❌ [Stock] Error reducing stock for order ${orderId}:`,
          stockError
        );
        // Don't fail the order update if stock update fails
      }
    }

    // Tăng lại tồn kho khi đơn hàng bị hủy (cancelled)
    // Chỉ tăng lại nếu đơn hàng đã được xác nhận trước đó (đã giảm stock)
    if (
      finalStatus === "cancelled" &&
      (previousStatus === "confirmed" ||
        previousStatus === "processing" ||
        previousStatus === "shipping" ||
        previousStatus === "delivered" ||
        previousStatus === "completed")
    ) {
      try {
        console.log(
          `📦 [Stock] Restoring stock for cancelled order ${orderId} (previous status: ${previousStatus})`
        );

        for (const item of verifiedOrder.items) {
          if (item.sku && item.quantity && item.quantity > 0) {
            // Sử dụng $inc để tăng lại stock
            const updateResult = await Product.findOneAndUpdate(
              { sku: item.sku },
              { $inc: { stock: item.quantity } },
              { new: true }
            );

            if (updateResult) {
              console.log(
                `✅ [Stock] Restored stock for SKU ${item.sku}: ${
                  updateResult.stock - item.quantity
                } -> ${updateResult.stock} (quantity: ${item.quantity})`
              );
            } else {
              console.warn(`⚠️ [Stock] Product not found for SKU: ${item.sku}`);
            }
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
        console.log(
          `📦 [Stock - ROUTES/ORDERS.JS] Restoring stock for returned order ${orderId} (previous status: ${previousStatus})`
        );
        console.log(
          `📦 [Stock - ROUTES/ORDERS.JS] Order items count: ${verifiedOrder.items.length}`
        );

        // Nhóm items theo SKU để tính tổng quantity (bao gồm cả purchased và gifted items)
        const stockRestoreMap = new Map();

        for (const item of verifiedOrder.items) {
          console.log(
            `📦 [Stock - ROUTES/ORDERS.JS] Processing item: SKU=${item.sku}, quantity=${item.quantity}, itemType=${item.itemType}`
          );
          if (item.sku && item.quantity && item.quantity > 0) {
            const currentTotal = stockRestoreMap.get(item.sku) || 0;
            stockRestoreMap.set(item.sku, currentTotal + item.quantity);
            console.log(
              `📦 [Stock - ROUTES/ORDERS.JS] Updated stock restore map for SKU ${
                item.sku
              }: ${currentTotal} -> ${currentTotal + item.quantity}`
            );
          } else {
            console.warn(
              `⚠️ [Stock - ROUTES/ORDERS.JS] Skipping item with invalid data: SKU=${item.sku}, quantity=${item.quantity}`
            );
          }
        }

        console.log(
          `📦 [Stock - ROUTES/ORDERS.JS] Stock restore map:`,
          Array.from(stockRestoreMap.entries())
        );

        // Tăng lại stock cho từng SKU
        for (const [sku, totalQuantity] of stockRestoreMap.entries()) {
          console.log(
            `📦 [Stock - ROUTES/ORDERS.JS] Attempting to restore stock for SKU ${sku}: quantity=${totalQuantity}`
          );

          // Kiểm tra product có tồn tại không
          const productBefore = await Product.findOne({ sku: sku });
          if (!productBefore) {
            console.error(
              `❌ [Stock - ROUTES/ORDERS.JS] Product not found for SKU: ${sku}`
            );
            continue;
          }

          console.log(
            `📦 [Stock - ROUTES/ORDERS.JS] Product found: SKU=${sku}, currentStock=${productBefore.stock}`
          );

          const updateResult = await Product.findOneAndUpdate(
            { sku: sku },
            { $inc: { stock: totalQuantity } }, // Tăng lại stock
            { new: true }
          );

          if (updateResult) {
            console.log(
              `✅ [Stock - ROUTES/ORDERS.JS] Restored stock for SKU ${sku} (returned): ${
                updateResult.stock - totalQuantity
              } -> ${updateResult.stock} (total quantity: ${totalQuantity})`
            );
          } else {
            console.error(
              `❌ [Stock - ROUTES/ORDERS.JS] Failed to update stock for SKU: ${sku}`
            );
          }
        }
      } catch (stockError) {
        console.error(
          `❌ [Stock - ROUTES/ORDERS.JS] Error restoring stock for returned order ${orderId}:`,
          stockError
        );
        // Don't fail the order update if stock update fails
      }
    }

    // If order is completed, recalculate customer's TotalSpent and CustomerTiering
    // CHỈ tính TotalSpent khi order có status = "completed" (KHÔNG tính "delivered")
    // if (finalStatus === "completed" || status === "delivered") {
    if (finalStatus === "completed") {
      try {
        // Update customer TotalSpent and CustomerTiering
        // Sử dụng service để tính lại từ tất cả orders đã completed
        const {
          updateUserTotalSpentAndTieringAsync,
        } = require("../services/totalspent-tiering.service");
        updateUserTotalSpentAndTieringAsync(User, Order, order.CustomerID);

        // Tăng purchase_count cho tất cả sản phẩm trong order (1 lượt per order, not per quantity)
        try {
          // Group items by SKU to ensure each product only gets +1 per order
          const uniqueSKUs = new Set();
          for (const item of order.items) {
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
          // Don't fail the order update if product update fails
        }
      } catch (error) {
        // Don't fail the order update if customer stats update fails
      }
    }

    res.json({
      success: true,
      message: "Order status updated successfully",
      data: responseOrder, // Use verified order to ensure we return the actual database state
    });
  } catch (error) {
    console.error("❌ [Orders] Error updating order status:", error);
    console.error("❌ [Orders] Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message,
    });
  }
});

// ========== DELETE ORDER ==========
// DELETE /api/orders/:orderId
router.delete("/:orderId", async (req, res) => {
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

    // console.log(` [Orders] Deleted order: ${orderId}`);

    res.json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (error) {
    // console.error(" [Orders] Error deleting order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete order",
      error: error.message,
    });
  }
});

module.exports = router;
