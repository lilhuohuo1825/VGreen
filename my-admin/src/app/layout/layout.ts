import {
  Component,
  computed,
  effect,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  HostListener,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';
import { NotificationService, AdminNotification } from '../services/notification.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-layout',
  imports: [CommonModule, RouterOutlet, RouterModule],
  templateUrl: './layout.html',
  styleUrl: './layout.css',
  standalone: true,
})
export class Layout implements OnInit, OnDestroy {
  @ViewChild('userDropdownWrapper') userDropdownWrapper!: ElementRef;

  currentPageTitle: string = 'Tổng quan';
  isSidebarCollapsed: boolean = false;
  showNotificationDropdown: boolean = false;
  showUserDropdown: boolean = false;
  showLogoutPopup: boolean = false;

  // Dark mode state
  isDarkMode = signal<boolean>(false);

  // Notifications
  notifications: AdminNotification[] = [];
  unreadCount: number = 0;
  private notificationSubscription: Subscription = new Subscription();

  // New notification popup
  showNewOrderPopup: boolean = false;
  newOrderNotification: AdminNotification | null = null;
  private newOrderPopupTimeout: any;
  private hasCheckedInitialNotifications: boolean = false; // Flag to check unread notifications on first load

  // Pending orders notification on login
  showPendingOrdersNotification: boolean = false;
  pendingOrdersCount: number = 0;
  processingReturnCount: number = 0;
  private pendingOrdersNotificationTimeout: any;

  // Danh sách các trang
  private pages: { [key: string]: { title: string; route: string } } = {
    dashboard: {
      title: 'Tổng quan',
      route: '/dashboard',
    },
    products: {
      title: 'Sản phẩm',
      route: '/products',
    },
    orders: {
      title: 'Đơn hàng',
      route: '/orders',
    },
    customers: {
      title: 'Khách hàng',
      route: '/customers',
    },
    promotions: {
      title: 'Khuyến mãi',
      route: '/promotions',
    },
    posts: {
      title: 'Bài viết',
      route: '/posts',
    },
    settings: {
      title: 'Cài đặt',
      route: '/settings',
    },
  };

  // Computed signals từ AuthService
  isAuthenticated = computed(() => this.authService.isAuthenticated());
  currentUser = computed(() => this.authService.currentUser());
  userDisplayName = computed(() =>
    this.isAuthenticated() ? this.currentUser()?.name || 'Quản trị viên' : 'Đăng nhập'
  );

  private http = inject(HttpClient);

  constructor(
    private router: Router,
    private authService: AuthService,
    private notificationService: NotificationService
  ) {
    // Effect để redirect về login nếu không authenticated
    // CHỈ redirect khi đang ở trong layout route và không authenticated
    effect(() => {
      const url = this.router.url;
      const isAuthenticated = this.isAuthenticated();

      // Chỉ redirect nếu:
      // 1. Không authenticated
      // 2. Không phải trang login
      // 3. URL không chứa 'undefined' hoặc lỗi routing
      if (!isAuthenticated && url && !url.includes('/login') && !url.includes('undefined')) {
        console.log('Layout: Not authenticated, redirecting to login');
        this.router.navigate(['/login']);
      }
    });
  }

  ngOnInit(): void {
    // Đã setup trong constructor
    // Load theme preference from localStorage
    this.loadTheme();

    // Load notifications
    this.notificationService.loadNotifications();
    this.notificationService.loadUnreadCount();

    // Subscribe to notifications
    const notifSub = this.notificationService.notifications$.subscribe((notifications) => {
      this.notifications = notifications.slice(0, 5); // Show only latest 5 in dropdown

      // Check for unread notifications on first load (when admin opens the page)
      // This handles cases where orders/returns were created outside business hours
      if (!this.hasCheckedInitialNotifications && notifications.length > 0) {
        this.hasCheckedInitialNotifications = true;
        // Delay slightly to ensure all subscriptions are set up
        setTimeout(() => {
          this.checkUnreadNotificationsOnLoad(notifications);
          this.checkPendingOrdersOnLogin(notifications);
        }, 500);
      }
    });
    this.notificationSubscription.add(notifSub);

    // Subscribe to unread count
    const countSub = this.notificationService.unreadCount$.subscribe((count) => {
      this.unreadCount = count;
    });
    this.notificationSubscription.add(countSub);

    // Subscribe to new notifications (for real-time popup)
    const newNotifSub = this.notificationService.newNotification$.subscribe((notification) => {
      if (notification) {
        if (notification.type === 'new_order') {
          // Chỉ hiển thị popup nếu order status là 'pending' hoặc 'processing_return'
          this.checkOrderStatusAndShowPopup(notification);
        } else if (notification.type === 'return_request') {
          // Hiển thị popup trực tiếp cho return request
          this.checkOrderStatusAndShowPopup(notification);
        }
      }
    });
    this.notificationSubscription.add(newNotifSub);
  }

  ngOnDestroy(): void {
    this.notificationSubscription.unsubscribe();
  }

  /**
   * Đóng dropdown khi click ra ngoài
   */
  @HostListener('document:click', ['$event'])
  onClickOutside(event: Event): void {
    if (this.showUserDropdown) {
      const clickedElement = event.target as HTMLElement;

      // Kiểm tra ViewChild đã được khởi tạo chưa
      if (this.userDropdownWrapper?.nativeElement) {
        const wrapperElement = this.userDropdownWrapper.nativeElement;

        // Nếu click không phải trong dropdown wrapper, đóng dropdown
        if (!wrapperElement.contains(clickedElement)) {
          this.showUserDropdown = false;
        }
      } else {
        // Nếu ViewChild chưa sẵn sàng, kiểm tra bằng class
        const userInfoElement = clickedElement.closest('.top-user-info');
        const dropdownElement = clickedElement.closest('.user-dropdown');

        // Nếu click không phải vào user info hoặc dropdown, đóng dropdown
        if (!userInfoElement && !dropdownElement) {
          this.showUserDropdown = false;
        }
      }
    }
  }

  /**
   * Điều hướng đến trang khi click menu
   */
  navigateTo(pageKey: string, event: Event): void {
    event.preventDefault();

    // Kiểm tra authentication
    if (!this.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    const page = this.pages[pageKey];
    if (page) {
      // Cập nhật tiêu đề
      this.currentPageTitle = page.title;

      // Navigate to route
      this.router.navigate([page.route]);

      // Cập nhật active state
      this.updateActiveMenu(event.target as HTMLElement);

      // Tự động đóng sidebar trên mobile
      if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
          sidebar.classList.remove('active');
        }
      }
    }
  }

  /**
   * Cập nhật trạng thái active cho menu
   */
  private updateActiveMenu(element: HTMLElement): void {
    // Xóa active khỏi tất cả menu links
    const allLinks = document.querySelectorAll('.menu-link');
    allLinks.forEach((link) => link.classList.remove('active'));

    // Thêm active cho link được click
    const menuLink = element.closest('.menu-link');
    if (menuLink) {
      menuLink.classList.add('active');
    }
  }

  /**
   * Toggle sidebar collapse/expand
   */
  toggleSidebarCollapse(): void {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  /**
   * Hiển thị popup xác nhận đăng xuất
   */
  logout(): void {
    this.showLogoutPopup = true;
  }

  /**
   * Xác nhận đăng xuất
   */
  confirmLogout(): void {
    this.showLogoutPopup = false;
    this.authService.logout();
  }

  /**
   * Hủy đăng xuất
   */
  cancelLogout(): void {
    this.showLogoutPopup = false;
  }

  /**
   * Xử lý click vào user info (hiển thị dropdown nếu đã authenticated, chuyển login nếu chưa)
   */
  onUserInfoClick(event: Event): void {
    event.stopPropagation(); // Ngăn event bubble để không trigger onClickOutside

    if (!this.isAuthenticated()) {
      this.router.navigate(['/login']);
    } else {
      // Toggle user dropdown
      this.showUserDropdown = !this.showUserDropdown;
      // Đóng các dropdown khác
      this.showNotificationDropdown = false;
    }
  }

  /**
   * Đóng user dropdown khi click ra ngoài
   */
  closeUserDropdown(): void {
    this.showUserDropdown = false;
  }

  /**
   * Đánh dấu thông báo đã đọc
   */
  markAsRead(notificationId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (!notificationId) {
      return;
    }
    this.notificationService.markAsRead(notificationId);
    // Reload unread count immediately
    setTimeout(() => {
      this.notificationService.loadUnreadCount();
    }, 100);
  }

  /**
   * Xử lý click vào notification - điều hướng đến trang tương ứng
   */
  onNotificationClick(notification: AdminNotification, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }

    // Đóng dropdown notification
    this.showNotificationDropdown = false;

    // Đánh dấu đã đọc nếu chưa đọc
    if (!notification.read) {
      const notificationId = notification._id || notification.id || '';
      if (notificationId) {
        this.markAsRead(notificationId);
      }
    }

    // Điều hướng dựa trên loại notification
    if (notification.type === 'consultation') {
      // Điều hướng đến trang quản lý tư vấn
      this.router.navigate(['/consultations']);
    } else if (notification.orderId) {
      // Điều hướng đến trang chi tiết đơn hàng
      this.router.navigate(['/orders', notification.orderId]);
    } else {
      // Nếu không có orderId, điều hướng đến trang đơn hàng chung
      this.router.navigate(['/orders']);
    }
  }

  /**
   * Xem tất cả thông báo
   */
  viewAllNotifications(): void {
    this.showNotificationDropdown = false;
    this.router.navigate(['/orders']); // Navigate to orders page for now
  }

  /**
   * Get notification title
   */
  getNotificationTitle(notification: AdminNotification): string {
    if (notification.title) {
      return notification.title;
    }

    switch (notification.type) {
      case 'order_cancellation_request':
        return `Yêu cầu hủy đơn hàng #${notification.orderId}`;
      case 'new_order':
        return `Đơn hàng mới #${notification.orderId}`;
      case 'return_request':
        return `Yêu cầu trả hàng #${notification.orderId}`;
      case 'consultation':
        return notification.title || 'Câu hỏi tư vấn mới';
      case 'system':
        return 'Thông báo hệ thống';
      default:
        return 'Thông báo';
    }
  }

  /**
   * Get notification message
   */
  getNotificationMessage(notification: AdminNotification): string {
    if (notification.message) {
      return notification.message;
    }

    switch (notification.type) {
      case 'order_cancellation_request':
        return `Khách hàng ${notification.customerId} yêu cầu hủy đơn hàng ${
          notification.orderId
        }. Lý do: ${notification.reason || 'Không có lý do'}`;
      case 'new_order':
        return `Có đơn hàng mới từ khách hàng ${notification.customerId} với tổng giá trị ${
          notification.orderTotal?.toLocaleString('vi-VN') || 0
        }₫`;
      case 'return_request':
        return `Khách hàng ${notification.customerId} yêu cầu trả hàng cho đơn hàng ${notification.orderId}`;
      case 'consultation':
        return (
          notification.message ||
          `Khách hàng ${
            notification.customerName || notification.customerId
          } đã đặt câu hỏi về sản phẩm "${notification.productName || ''}"`
        );
      default:
        return '';
    }
  }

  /**
   * Format timestamp
   */
  formatTimeAgo(date: Date | string): string {
    const dateObj = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - dateObj.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffHours < 24) return `${diffHours} giờ trước`;
    return `${diffDays} ngày trước`;
  }

  /**
   * Get notification icon
   */
  getNotificationIcon(notification: AdminNotification): string {
    switch (notification.type) {
      case 'order_cancellation_request':
        return '/assets/icons/trash_red.png';
      case 'new_order':
        return '/assets/icons/order.png';
      case 'return_request':
        return '/assets/icons/return.png';
      case 'consultation':
        return '/assets/icons/edit.png';
      case 'system':
        return '/assets/icons/info.png';
      default:
        return '/assets/icons/order.png';
    }
  }

  /**
   * Load theme preference from localStorage
   */
  private loadTheme(): void {
    const savedTheme = localStorage.getItem('admin_theme');
    if (savedTheme) {
      const isDark = savedTheme === 'dark';
      this.isDarkMode.set(isDark);
      this.applyTheme(isDark);
    } else {
      // Default to light mode
      this.isDarkMode.set(false);
      this.applyTheme(false);
    }
  }

  /**
   * Toggle theme between dark and light mode
   */
  toggleTheme(): void {
    const newMode = !this.isDarkMode();
    this.isDarkMode.set(newMode);
    this.applyTheme(newMode);
    localStorage.setItem('admin_theme', newMode ? 'dark' : 'light');
  }

  /**
   * Apply theme to document
   */
  private applyTheme(isDark: boolean): void {
    const htmlElement = document.documentElement;
    const bodyElement = document.body;

    if (isDark) {
      htmlElement.classList.add('dark-mode');
      bodyElement.classList.add('dark-mode');
    } else {
      htmlElement.classList.remove('dark-mode');
      bodyElement.classList.remove('dark-mode');
    }
  }

  /**
   * Check order status and show popup only for pending or processing_return orders
   */
  private checkOrderStatusAndShowPopup(notification: AdminNotification): void {
    if (!notification.orderId) {
      console.log('⚠️ [Layout] No orderId in notification, skipping popup');
      return;
    }

    // Fetch order to check status - try OrderID first (from routes/orders.js)
    this.http.get<any>(`${environment.apiUrl}/orders/${notification.orderId}`).subscribe({
      next: (response) => {
        let order: any = null;
        let orderStatus: string | null = null;

        // Handle different response formats
        if (response && response.success && response.data) {
          // Format from routes/orders.js: { success: true, data: order }
          order = response.data;
        } else if (response && response.status) {
          // Format from server.js: { status: '...', ... }
          order = response;
        } else if (response && !response.success && !response.error) {
          // Direct order object
          order = response;
        }

        if (order) {
          orderStatus = order.status;

          console.log(`🔍 [Layout] Order ${notification.orderId} status: ${orderStatus}`);

          // Chỉ hiển thị popup nếu order status là 'pending' hoặc 'processing_return'
          if (orderStatus === 'pending' || orderStatus === 'processing_return') {
            console.log(
              `✅ [Layout] Showing popup for order ${notification.orderId} with status ${orderStatus}`
            );
            this.showNewOrderNotification(notification);
          } else {
            console.log(
              `⏭️ [Layout] Skipping popup for order ${notification.orderId} with status ${orderStatus} (only showing for pending or processing_return)`
            );
          }
        } else {
          console.warn('⚠️ [Layout] Order not found or invalid response:', response);
        }
      },
      error: (error) => {
        console.error('❌ [Layout] Error fetching order status:', error);
        // Nếu không fetch được, không hiển thị popup để tránh hiển thị sai
      },
    });
  }

  /**
   * Show new order notification popup
   */
  showNewOrderNotification(notification: AdminNotification): void {
    this.newOrderNotification = notification;
    this.showNewOrderPopup = true;

    // Auto close after 5 seconds
    if (this.newOrderPopupTimeout) {
      clearTimeout(this.newOrderPopupTimeout);
    }
    this.newOrderPopupTimeout = setTimeout(() => {
      this.closeNewOrderPopup();
    }, 5000);
  }

  /**
   * Close new order popup
   */
  closeNewOrderPopup(): void {
    this.showNewOrderPopup = false;
    if (this.newOrderPopupTimeout) {
      clearTimeout(this.newOrderPopupTimeout);
      this.newOrderPopupTimeout = null;
    }
  }

  /**
   * Navigate to order detail from popup
   */
  goToOrderFromPopup(): void {
    if (this.newOrderNotification && this.newOrderNotification.orderId) {
      this.closeNewOrderPopup();
      this.router.navigate(['/orders', this.newOrderNotification.orderId]);
    }
  }

  /**
   * Check for unread notifications when admin opens the page
   * This handles cases where orders/returns were created outside business hours
   * Only shows popup for notifications with pending/processing_return status
   */
  private checkUnreadNotificationsOnLoad(notifications: AdminNotification[]): void {
    // Find the latest unread notification of type 'new_order' or 'return_request'
    const unreadNotifications = notifications
      .filter((n) => !n.read && (n.type === 'new_order' || n.type === 'return_request'))
      .sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA; // Sort by newest first
      });

    if (unreadNotifications.length > 0) {
      const latestUnread = unreadNotifications[0];
      console.log('🔔 [Layout] Found unread notification on page load:', latestUnread);

      // Check order status and show popup if order is still pending/processing_return
      if (latestUnread.type === 'new_order' || latestUnread.type === 'return_request') {
        this.checkOrderStatusAndShowPopup(latestUnread);
      }
    } else {
      console.log('ℹ️ [Layout] No unread notifications found on page load');
    }
  }

  /**
   * Check and show notification about pending orders when admin logs in
   */
  private checkPendingOrdersOnLogin(notifications: AdminNotification[]): void {
    // Count pending orders and return requests from notifications
    const pendingOrderNotifications = notifications.filter(
      (n) => !n.read && n.type === 'new_order'
    );
    const returnRequestNotifications = notifications.filter(
      (n) => !n.read && n.type === 'return_request'
    );

    // Show notification if there are pending orders OR return requests
    if (pendingOrderNotifications.length > 0 || returnRequestNotifications.length > 0) {
      // Fetch actual orders count from API to verify
      this.http.get<any>(`${environment.apiUrl}/orders`).subscribe({
        next: (response) => {
          let orders: any[] = [];

          // Handle different response formats
          if (response && Array.isArray(response)) {
            orders = response;
          } else if (response && response.success && Array.isArray(response.data)) {
            orders = response.data;
          } else if (response && Array.isArray(response.data)) {
            orders = response.data;
          }

          // Count orders with pending status
          const pendingCount = orders.filter((order: any) => order.status === 'pending').length;

          // Count orders with processing_return status
          const processingReturnCount = orders.filter(
            (order: any) => order.status === 'processing_return'
          ).length;

          // Show notification if there are pending orders OR return requests
          if (pendingCount > 0 || processingReturnCount > 0) {
            this.pendingOrdersCount = pendingCount;
            this.processingReturnCount = processingReturnCount;
            this.showPendingOrdersNotification = true;

            // Auto close after 8 seconds
            if (this.pendingOrdersNotificationTimeout) {
              clearTimeout(this.pendingOrdersNotificationTimeout);
            }
            this.pendingOrdersNotificationTimeout = setTimeout(() => {
              this.closePendingOrdersNotification();
            }, 8000);

            console.log(
              `📊 [Layout] Found ${pendingCount} pending orders and ${processingReturnCount} return requests on login`
            );
          }
        },
        error: (error) => {
          console.error('❌ [Layout] Error fetching orders count:', error);
          // Fallback: use notification count
          if (pendingOrderNotifications.length > 0 || returnRequestNotifications.length > 0) {
            this.pendingOrdersCount = pendingOrderNotifications.length;
            this.processingReturnCount = returnRequestNotifications.length;
            this.showPendingOrdersNotification = true;

            if (this.pendingOrdersNotificationTimeout) {
              clearTimeout(this.pendingOrdersNotificationTimeout);
            }
            this.pendingOrdersNotificationTimeout = setTimeout(() => {
              this.closePendingOrdersNotification();
            }, 8000);
          }
        },
      });
    }
  }

  /**
   * Close pending orders notification
   */
  closePendingOrdersNotification(): void {
    this.showPendingOrdersNotification = false;
    if (this.pendingOrdersNotificationTimeout) {
      clearTimeout(this.pendingOrdersNotificationTimeout);
      this.pendingOrdersNotificationTimeout = null;
    }
  }

  /**
   * Navigate to orders page from pending orders notification
   * Automatically filter based on what orders are available:
   * - If only pending → filter=pending
   * - If both pending and processing_return → filter=pending (prioritize pending)
   * - If only processing_return → filter=refund-requested
   */
  goToOrdersFromNotification(): void {
    this.closePendingOrdersNotification();

    let filterType = 'pending'; // Default to pending

    // Determine filter based on available orders
    if (this.pendingOrdersCount > 0) {
      // If there are pending orders, always filter by pending (even if there are also return requests)
      filterType = 'pending';
    } else if (this.processingReturnCount > 0) {
      // If only return requests (no pending), filter by refund-requested
      filterType = 'refund-requested';
    }

    console.log(`🔍 [Layout] Navigating to orders with filter: ${filterType}`, {
      pendingCount: this.pendingOrdersCount,
      processingReturnCount: this.processingReturnCount,
    });

    this.router.navigate(['/orders'], { queryParams: { filter: filterType } });
  }
}
