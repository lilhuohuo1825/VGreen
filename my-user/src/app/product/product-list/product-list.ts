import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { forkJoin, fromEvent, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { AuthService } from '../../services/auth.service';
import { ProductService } from '../../services/product.service';
import { AuthPopupService } from '../../services/auth-popup.service';

interface Product {
  _id: string;
  Category: string;
  Subcategory: string;
  ProductName: string;
  Brand: string;
  Unit: string;
  Price: number;
  Image: string[]; // Đổi từ string sang string[] (array of images)
  sku: string; // lowercase để match với product.json
  Origin: string;
  Weight: string;
  Ingredients: string;
  Usage: string;
  Storage: string;
  ManufactureDate: string;
  ExpiryDate: string;
  Producer: string;
  SafetyWarning: string;
  ResponsibleOrg: string;
  Color: any;
  Rating?: number;
  Promotion?: string;
  OriginalPrice?: number;
  Discount?: number;
  ReviewCount?: number;
  Reviews?: any[];
  PurchaseCount?: number; // Thêm trường purchase_count
  liked?: number; // Số lượt like
  PostDate?: string; // Thêm trường post_date
  hasPromotion?: boolean;
  discountedPrice?: number;
  discountPercent?: number;
  promotionType?: 'normal' | 'buy1get1' | ('normal' | 'buy1get1')[]; // Loại khuyến mãi: có thể là 1 loại hoặc mảng các loại
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: 'product-list.html',
  styleUrl: 'product-list.css',
})
export class ProductListComponent implements OnInit, AfterViewInit, OnDestroy {
  // -----------------------------
  // 🎯 ViewChild References
  // -----------------------------
  @ViewChild('filtersContainer') filtersContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('sidebar') sidebar!: ElementRef<HTMLDivElement>;
  @ViewChild('productMainContent') productMainContent!: ElementRef<HTMLDivElement>;

  // Subscriptions
  private subscriptions: Subscription[] = [];

  // -----------------------------
  // 🧱 Cấu trúc dữ liệu chính
  // -----------------------------
  products: Product[] = [];
  filteredProducts: Product[] = [];
  displayedProducts: Product[] = [];
  sortOption: string = 'price-low';
  categorySort: string = 'name';
  priceSort: string = 'price-low';
  isLoading: boolean = true;
  hasError: boolean = false;
  itemsPerPage: number = 24;
  hasMoreProducts: boolean = true;

  // -----------------------------
  // 🎯 Scroll to Top Properties
  // -----------------------------
  showScrollButton: boolean = false;
  private scrollThreshold: number = 300; // Hiển thị button sau khi scroll 300px

  // -----------------------------
  //  Mobile Sidebar Properties
  // -----------------------------
  isMobileSidebarOpen: boolean = false;

  // -----------------------------
  // 🧩 Bộ lọc
  // -----------------------------
  selectedCategories: string[] = [];
  selectedSubcategories: string[] = [];
  selectedPromotions: string[] = [];
  selectedColors: string[] = [];
  selectedRating: number | null = null;

  //  Các biến thanh trượt giá
  minPrice: number = 0;
  maxPrice: number = 1000000;
  priceRange: number[] = [0, 1000000];
  actualMaxPrice: number = 1000000; // Max price của products hiện tại
  initialMinPrice: number = 0; // Giá min ban đầu để so sánh
  initialMaxPrice: number = 1000000; // Giá max ban đầu để so sánh

  // -----------------------------
  // 🧰 Dữ liệu lựa chọn có sẵn
  // -----------------------------
  categories: string[] = [];
  subcategories: string[] = [];
  promotions: string[] = ['Giảm giá', 'Mua 1 tặng 1'];
  colors: string[] = [];
  ratings: number[] = [5, 4, 3, 2, 1];

  // -----------------------------
  // 🧭 Trạng thái hiển thị
  // -----------------------------
  currentView: 'categories' | 'subcategories' = 'categories';
  currentCategory: string = '';
  currentSubcategory: string = '';
  breadcrumb: string[] = ['Trang chủ', 'Sản phẩm'];
  searchQuery: string = ''; // Từ khóa tìm kiếm từ URL

  // -----------------------------
  // 📁 Giao diện điều khiển mở rộng
  // -----------------------------
  expandedSections: { [key: string]: boolean } = {
    price: true,
    rating: true,
    promotion: true,
    color: true,
    brand: true,
  };

  // -----------------------------
  //  Các bộ lọc đang hoạt động
  // -----------------------------
  activeFilters: Array<{ type: string; value: string; label: string }> = [];

  // -----------------------------
  // 🎯 Favorite Properties
  // -----------------------------
  favoriteProducts: string[] = [];

  // -----------------------------
  // 🎯 Promotion Box Properties
  // -----------------------------
  currentBoxIndex: number = 0;
  totalBoxes: number = 6;

  // -----------------------------
  // 🎯 Khởi tạo
  // -----------------------------
  private apiUrl = '/api'; // Use proxy configuration

  constructor(
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute,
    private cartService: CartService,
    private wishlistService: WishlistService,
    private authService: AuthService,
    private productService: ProductService,
    private authPopupService: AuthPopupService
  ) { }

  ngOnInit(): void {
    console.log('ProductListComponent ngOnInit - Starting to load products');
    console.log('Initial state - isLoading:', this.isLoading, 'hasError:', this.hasError);
    this.loadProducts();
    this.loadFavoriteProducts();
    // handleQueryParams() will be called after products are loaded

    //  Thêm scroll listener
    this.initScrollListener();
  }

  ngAfterViewInit(): void {
    // Set sidebar height based on product grid
    this.updateSidebarHeight();

    // Re-check on window resize and when products change
    const resizeSub = fromEvent(window, 'resize')
      .pipe(debounceTime(200))
      .subscribe(() => this.updateSidebarHeight());

    this.subscriptions.push(resizeSub);

    // Restore scroll position và state sau khi view đã init và products đã load
    setTimeout(() => {
      this.restoreScrollState();
    }, 500); // Delay để đảm bảo products đã render
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe());

    //  Cleanup scroll listener
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleScroll);
    }
  }

  // -----------------------------
  // 🎯 Sidebar Height Management
  // -----------------------------
  private updateSidebarHeight(): void {
    if (!this.sidebar || !this.productMainContent) {
      console.log(' updateSidebarHeight: sidebar or productMainContent not found', {
        sidebar: !!this.sidebar,
        productMainContent: !!this.productMainContent,
      });
      return;
    }

    const sidebarElement = this.sidebar.nativeElement;
    const mainContentElement = this.productMainContent.nativeElement;

    // Get the actual height of the product main content (includes banner + grid + etc.)
    const mainContentHeight = mainContentElement.offsetHeight;

    console.log('📏 updateSidebarHeight called - Main content height:', mainContentHeight);

    if (mainContentHeight > 0) {
      // Set sidebar max-height to match main content height
      sidebarElement.style.maxHeight = `${mainContentHeight}px`;
      console.log(' Sidebar max-height set to:', mainContentHeight, 'px');
    } else {
      // Fallback to viewport height if main content not loaded yet
      sidebarElement.style.maxHeight = 'calc(100vh - 40px)';
      console.log(' Main content height is 0, using viewport fallback');
    }
  }

  // -----------------------------
  // 🎯 Scroll Handling Methods
  // -----------------------------
  private initScrollListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', this.handleScroll.bind(this));
    }
  }

  private handleScroll = (): void => {
    if (typeof window !== 'undefined') {
      // Hiển thị button khi scroll xuống > threshold
      const scrollY = window.scrollY || window.pageYOffset;
      // Hiển thị button khi scroll > threshold, ẩn khi ở đầu trang (scrollY <= 0)
      this.showScrollButton = scrollY > this.scrollThreshold && scrollY > 0;
    }
  };

  scrollToTop(): void {
    if (typeof window !== 'undefined') {
      // Smooth scroll lên đầu trang
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  }

  // -----------------------------
  //  Mobile Sidebar Methods
  // -----------------------------
  toggleMobileSidebar(): void {
    this.isMobileSidebarOpen = !this.isMobileSidebarOpen;
    if (this.isMobileSidebarOpen) {
      document.body.style.overflow = 'hidden'; // Prevent background scroll
    } else {
      document.body.style.overflow = '';
    }
  }

  closeMobileSidebar(): void {
    this.isMobileSidebarOpen = false;
    document.body.style.overflow = '';
  }

  onOverlayClick(): void {
    this.closeMobileSidebar();
  }

  // -----------------------------
  //  Xử lý Query Parameters
  // -----------------------------
  handleQueryParams(): void {
    this.route.queryParams.subscribe((params) => {
      console.log('Query params received:', params);

      //  Check for search parameter - Priority check
      if (params['search']) {
        this.searchQuery = params['search'];
        this.breadcrumb = ['Trang chủ', 'Sản phẩm', `Kết quả tìm kiếm: "${this.searchQuery}"`];
        this.currentView = 'categories';
        this.currentCategory = '';
        this.currentSubcategory = '';
        this.selectedCategories = [];
        this.selectedSubcategories = [];
        console.log(' Search query set to:', this.searchQuery);

        // Apply filters with search query
        setTimeout(() => {
          this.applyFilters();
          this.updatePageTitle();
        }, 100);
        return; // Don't process other params when searching
      } else {
        // Clear search query if not present
        this.searchQuery = '';
      }

      //  Check for sort parameter
      if (params['sort']) {
        const sortValue = params['sort'];
        if (sortValue === 'newest' || sortValue === 'bestseller') {
          this.categorySort = sortValue;
          console.log(' Sort set to:', sortValue);
        }
      }

      //  Check for promotion filter parameter
      if (params['promotion']) {
        const promotionValue = params['promotion'];
        if (promotionValue === 'true') {
          this.selectedPromotions = ['Giảm giá'];
          console.log(' Promotion filter enabled');
        }
      }

      if (params['category']) {
        // Reset các bộ lọc khi chọn category/subcategory mới từ header hoặc navigation
        this.resetFilterSelections();

        const category = this.convertSlugToCategory(params['category']);
        console.log(' Query param - category slug:', params['category']);
        console.log(' Converted to category:', category);
        this.currentCategory = category;
        this.currentView = 'subcategories'; // Hiển thị subcategories view
        this.breadcrumb = ['Trang chủ', 'Sản phẩm', category];
        this.selectedCategories = [category];

        if (params['subcategory']) {
          const subcategory = this.convertSlugToSubcategory(params['subcategory']);
          console.log(' Query param - subcategory slug:', params['subcategory']);
          console.log(' Converted to subcategory:', subcategory);
          this.currentSubcategory = subcategory;
          this.breadcrumb = ['Trang chủ', 'Sản phẩm', category, subcategory];
          this.selectedSubcategories = [subcategory];
        } else {
          // Chọn "Tất cả sản phẩm" - không filter theo subcategory
          this.currentSubcategory = '';
          this.selectedSubcategories = [];
        }

        // Apply filters after products are loaded
        setTimeout(() => {
          this.updateSubcategories();
          this.updateSortOption();
          this.applyFilters();
          this.updatePageTitle();
        }, 100);
      } else {
        // Không có query parameters - hiển thị trang product-list thông thường
        this.currentView = 'categories';
        this.currentCategory = '';
        this.currentSubcategory = '';
        this.breadcrumb = ['Trang chủ', 'Sản phẩm'];
        this.selectedCategories = [];
        this.selectedSubcategories = [];

        // Apply filters
        setTimeout(() => {
          this.updateSubcategories();
          this.updateSortOption();
          this.applyFilters();
          this.updatePageTitle();
        }, 100);
      }
    });
  }

  convertSlugToCategory(slug: string): string {
    const categoryMap: { [key: string]: string } = {
      'rau-cu': 'Rau củ',
      'rau-củ': 'Rau củ',
      'trai-cay': 'Trái cây',
      'trái-cây': 'Trái cây',
      'luong-thuc-ngu-coc': 'Lương thực - ngũ cốc',
      'lương-thực---ngũ-cốc': 'Lương thực - ngũ cốc',
      'thuc-pham-kho': 'Thực phẩm khô',
      'thực-phẩm-khô': 'Thực phẩm khô',
      'tra-thao-moc': 'Trà xanh',
      'trà-xanh': 'Trà xanh',
      'ca-phe-cacao': 'Cà phê, Cacao',
      'cà-phê,-cacao': 'Cà phê, Cacao',
      'thuc-pham-boi-bo': 'Thực phẩm bồi bổ',
      'thực-phẩm-bồi-bổ': 'Thực phẩm bồi bổ',
      'rong-bien': 'Rong biển',
      'rong-biển': 'Rong biển',
    };

    console.log(' convertSlugToCategory - input:', slug);
    const result = categoryMap[slug] || slug.replace(/-/g, ' ');
    console.log(' convertSlugToCategory - output:', result);
    return result;
  }

  convertSlugToSubcategory(slug: string): string {
    console.log(' convertSlugToSubcategory - input:', slug);

    // If products are already loaded, dynamically create slug mapping from actual subcategories
    if (this.products && this.products.length > 0) {
      const uniqueSubcategories = [...new Set(this.products.map((p) => p.Subcategory))];

      // Try to match the slug with actual subcategories
      for (const subcat of uniqueSubcategories) {
        const subcatSlug = this.createSlug(subcat);
        if (subcatSlug === slug) {
          console.log(' convertSlugToSubcategory - output (dynamic):', subcat);
          return subcat;
        }
      }
    }

    // Fallback: return slug with hyphens replaced by spaces and capitalized
    const result = slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    console.log(' convertSlugToSubcategory - output (fallback):', result);
    return result;
  }

  /**
   * Create URL-friendly slug from Vietnamese text
   * Removes accents and special characters, converts to lowercase, replaces spaces with hyphens
   */
  private createSlug(text: string): string {
    return this.removeVietnameseAccents(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Remove Vietnamese accents/diacritics
   */
  private removeVietnameseAccents(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  // -----------------------------
  //  Tải dữ liệu
  // -----------------------------
  // -----------------------------
  //  Tải dữ liệu
  // -----------------------------
  currentFilters: any = {
    page: 1,
    limit: 24,
    sort: 'newest'
  };

  loadProducts(): void {
    console.log('loadProducts() called - Fetching from MongoDB API with filters:', this.currentFilters);
    this.hasError = false;
    this.isLoading = true;

    // Load products with current filters
    this.productService.getAllProducts(this.currentFilters).subscribe({
      next: (response) => {
        console.log(' API request successful - Products:', response.products.length);

        // Map products (giữ nguyên logic mapping cũ)
        this.products = response.products.map((p) => ({
          _id: p._id,
          ProductName: p.product_name ?? '',
          Category: p.category ?? '',
          Subcategory: p.subcategory ?? '',
          Brand: p.brand ?? '',
          Unit: p.unit ?? '',
          Price: p.price ?? 0,
          Image: Array.isArray(p.image) ? p.image : [p.image || ''],
          sku: p.sku ?? '',
          Origin: p.origin ?? '',
          Weight: p.weight ?? '',
          Ingredients: p.ingredients ?? '',
          Usage: p.usage ?? '',
          Storage: p.storage ?? '',
          ManufactureDate: p.manufacture_date ?? '',
          ExpiryDate: p.expiry_date ?? '',
          Producer: p.producer ?? '',
          SafetyWarning: p.safety_warning ?? '',
          ResponsibleOrg: '',
          Color: p.color,
          Rating: (p.rating ?? 0),
          Promotion: undefined,
          OriginalPrice: p.base_price,
          Discount: undefined,
          ReviewCount: p.purchase_count ?? 0, // Tạm dùng purchase_count làm review count nếu chưa có
          Reviews: [],
          PurchaseCount: p.purchase_count ?? 0,
          liked: p.liked ?? 0,
          PostDate: p.post_date,
          hasPromotion: false, // Sẽ được update từ promotion API nếu cần
        }));

        // Update pagination info
        this.itemsPerPage = response.pagination.limit;
        this.hasMoreProducts = response.pagination.hasNextPage;

        // Server đã filter rồi nên filteredProducts chính là products
        this.filteredProducts = [...this.products];
        this.displayedProducts = [...this.products];

        this.isLoading = false;

        // Load promotions riêng nếu cần hiển thị badge (optional)
        // this.loadPromotions(); 
      },
      error: (error) => {
        console.error(' API request failed:', error);
        this.isLoading = false;
        this.hasError = true;
        this.products = [];
        this.filteredProducts = [];
      }
    });
  }

  loadFilterOptions(): void {
    // Load categories and subcategories from metadata endpoints
    this.http.get<any>(`${this.apiUrl}/products/metadata/categories`).subscribe({
      next: (res) => {
        if (res.success) {
          this.categories = res.data;
        }
      }
    });

    this.http.get<any>(`${this.apiUrl}/products/metadata/subcategories`).subscribe({
      next: (res) => {
        if (res.success) {
          this.subcategories = res.data;
        }
      }
    });
  }

  updateSubcategories(): void {
    if (this.currentCategory) {
      // Nếu đã chọn category, filter subcategories tương ứng (nếu có API hỗ trợ hoặc filter client-side từ metadata)
      // Hiện tại metadata trả về tất cả subcategories, ta có thể cần endpoint mới hoặc filter tạm thời
      // Tuy nhiên, vì server-side filtering, ta nên để server xử lý việc này hoặc load lại metadata theo category
      // Tạm thời giữ nguyên logic hiển thị tất cả hoặc filter nếu có thể

      // Nếu muốn filter subcategories theo category, ta cần map category -> subcategories từ server
      // Hoặc gọi API: /api/products/metadata/subcategories?category=...

      // Tạm thời hiển thị tất cả subcategories đã load
    }
  }

  updatePriceRange(): void {
    // Server-side filtering: Price range nên được set bởi user, không phải tự động co giãn theo products hiện tại
    // Tuy nhiên, để UX tốt, ta có thể lấy min/max price của toàn bộ products từ server metadata
    // Tạm thời giữ nguyên logic set min/max default hoặc từ user input
  }

  // -----------------------------
  // 💰 Thanh chọn khoảng giá (Range Slider)
  // -----------------------------
  onMinSliderChange(event: any): void {
    const newMin = parseInt(event.target.value);
    // Prevent min from exceeding max
    if (newMin >= this.maxPrice) {
      this.minPrice = Math.max(0, this.maxPrice - 1000);
    } else {
      this.minPrice = newMin;
    }
    this.priceRange[0] = this.minPrice;
    // Force update the slider value to prevent cross-over
    event.target.value = this.minPrice;
    this.applyFilters();
  }

  onMaxSliderChange(event: any): void {
    const newMax = parseInt(event.target.value);
    // Limit to actualMaxPrice
    const clampedMax = Math.min(newMax, this.actualMaxPrice);
    // Prevent max from going below min
    if (clampedMax <= this.minPrice) {
      this.maxPrice = Math.min(this.actualMaxPrice, this.minPrice + 1000);
    } else {
      this.maxPrice = clampedMax;
    }
    this.priceRange[1] = this.maxPrice;
    // Force update the slider value to prevent cross-over
    event.target.value = this.maxPrice;
    this.applyFilters();
  }

  onMinInputChange(event: any): void {
    const value = this.parseCurrency(event.target.value);
    if (value <= this.maxPrice) {
      this.minPrice = value;
    } else {
      this.minPrice = this.maxPrice;
    }
    this.priceRange[0] = this.minPrice;
    event.target.value = this.formatPrice(this.minPrice);
    this.applyFilters();
  }

  onMaxInputChange(event: any): void {
    const value = this.parseCurrency(event.target.value);
    // Limit to actualMaxPrice
    const clampedMax = Math.min(value, this.actualMaxPrice);
    if (clampedMax >= this.minPrice) {
      this.maxPrice = clampedMax;
    } else {
      this.maxPrice = this.minPrice;
    }
    this.priceRange[1] = this.maxPrice;
    event.target.value = this.formatPrice(this.maxPrice);
    this.applyFilters();
  }

  getSliderLeft(): number {
    return (this.minPrice / this.actualMaxPrice) * 100;
  }

  getSliderRight(): number {
    return 100 - (this.maxPrice / this.actualMaxPrice) * 100;
  }

  // Format rating to always show 1 decimal place (e.g., 3.0, 4.5, 5.0)
  formatRating(rating: number | undefined | null): string {
    if (!rating || rating === 0) {
      return '0.0';
    }
    return rating.toFixed(1);
  }

  formatPrice(value: number): string {
    return value.toLocaleString('vi-VN') + '₫';
  }

  parseCurrency(value: string): number {
    return parseInt(value.replace(/[₫.]/g, '')) || 0;
  }

  // -----------------------------
  // 🧭 Navigation methods
  // -----------------------------
  onCategoryClick(category: string): void {
    // Khi click vào category, clear search query để sidebar hoạt động bình thường
    this.searchQuery = '';
    // Reset các bộ lọc đã chọn trước đó
    this.resetFilterSelections();
    this.currentCategory = category;
    this.currentView = 'subcategories';
    this.breadcrumb = ['Trang chủ', 'Sản phẩm', category];
    this.selectedCategories = [category];
    this.updateSubcategories();
    // Update brands based on selected category
    this.applyFilters();
    console.log('Clicked category:', category);
    console.log('Current view:', this.currentView);
    console.log('Subcategories loaded:', this.subcategories);
    console.log('Search query cleared');
    console.log('Filters reset');
  }

  onSubcategoryClick(subcategory: string, event?: any): void {
    // Khi click vào subcategory, clear search query để sidebar hoạt động bình thường
    this.searchQuery = '';
    // Reset các bộ lọc đã chọn trước đó
    this.resetFilterSelections();
    this.currentSubcategory = subcategory;
    this.breadcrumb = ['Trang chủ', 'Sản phẩm', this.currentCategory];
    this.selectedSubcategories = [subcategory];
    this.updateSubcategories(); // This will call updatePriceRange()
    this.applyFilters();
    console.log('Search query cleared');
    console.log('Filters reset');
  }

  onBreadcrumbClick(item: string, index: number): void {
    if (index === 0) {
      // Click vào "Trang chủ" - điều hướng về trang chủ
      this.router.navigate(['/']);
      return;
    } else if (index === 1) {
      // Click vào "Sản phẩm" - chuyển về categories view và clear search query
      this.searchQuery = '';
      this.currentView = 'categories';
      this.currentCategory = '';
      this.currentSubcategory = '';
      this.breadcrumb = ['Trang chủ', 'Sản phẩm'];
      this.selectedCategories = [];
      this.selectedSubcategories = [];
      this.updateSubcategories();
      this.applyFilters();
      console.log('Search query cleared');
    } else if (index === 2) {
      // Click vào category - chuyển về subcategories view
      // Reset các bộ lọc đã chọn trước đó
      this.resetFilterSelections();
      this.currentView = 'subcategories';
      this.currentSubcategory = '';
      this.breadcrumb = ['Trang chủ', 'Sản phẩm', this.currentCategory];
      this.selectedSubcategories = [];
      this.updateSubcategories();
      this.applyFilters();
    }
    console.log('Breadcrumb clicked:', item, 'at index:', index);
    console.log('Current view after click:', this.currentView);
  }

  // -----------------------------
  //  Apply Filters
  // -----------------------------
  applyFilters(): void {
    console.log(' applyFilters() called - Updating server filters');

    // Update filters based on current selection
    this.currentFilters.page = 1; // Reset to page 1 when filtering

    // Category & Subcategory
    this.currentFilters.category = this.selectedCategories.length > 0 ? this.selectedCategories[0] : undefined;
    this.currentFilters.subcategory = this.selectedSubcategories.length > 0 ? this.selectedSubcategories[0] : undefined;

    // Search
    this.currentFilters.search = this.searchQuery || undefined;

    // Price
    this.currentFilters.minPrice = this.minPrice;
    this.currentFilters.maxPrice = this.maxPrice;

    // Promotion
    const hasDiscountFilter = this.selectedPromotions.includes('Giảm giá');
    const hasBuy1Get1Filter = this.selectedPromotions.includes('Mua 1 tặng 1');
    if (hasDiscountFilter || hasBuy1Get1Filter) {
      this.currentFilters.promotion = true;
    } else {
      this.currentFilters.promotion = undefined;
    }

    // Reload products with new filters
    this.loadProducts();
    this.updateActiveFilters();
  }

  // -----------------------------
  //  Clear filters
  // -----------------------------
  clearAllFilters(): void {
    this.selectedCategories = [];
    this.selectedPromotions = [];
    this.selectedColors = [];
    this.selectedRating = null;
    this.currentView = 'categories';
    this.currentCategory = '';
    this.currentSubcategory = '';
    this.breadcrumb = ['Trang chủ', 'Sản phẩm'];
    this.activeFilters = [];
    this.updateSubcategories();
    this.applyFilters();
  }

  // Reset các bộ lọc (price, rating, promotion, color) khi chọn category/subcategory mới
  resetFilterSelections(): void {
    // Reset các bộ lọc khác trước
    this.selectedPromotions = [];
    this.selectedColors = [];
    this.selectedRating = null;

    // Clear active filters (chỉ các filter từ filter-section, không bao gồm category/subcategory)
    this.activeFilters = [];

    // Reset price range về giá trị mặc định (sẽ được cập nhật lại bởi updatePriceRange() sau khi updateSubcategories())
    this.minPrice = 0;
    this.maxPrice = 1000000;
    this.priceRange = [0, 1000000];
  }

  // -----------------------------
  // 📄 Load More methods
  // -----------------------------
  loadMoreProducts(): void {
    if (this.hasMoreProducts) {
      // Kiểm tra xem có productId đang chờ scroll không (khi quay lại từ product-detail)
      const savedStateStr = localStorage.getItem('productListScrollState');
      const productIdToScroll = savedStateStr ? JSON.parse(savedStateStr).selectedProductId : null;

      this.itemsPerPage += 24;
      this.updateDisplayedProducts();

      // Nếu có productId đang chờ scroll, scroll đến product đó sau khi load thêm
      if (productIdToScroll) {
        setTimeout(() => {
          const savedState = JSON.parse(savedStateStr!);
          // Kiểm tra xem sản phẩm bây giờ đã có trong displayedProducts chưa
          const isNowDisplayed = this.displayedProducts.some(
            (p) => p.sku === productIdToScroll || p._id === productIdToScroll
          );

          if (isNowDisplayed) {
            // Nếu sản phẩm bây giờ đã hiển thị, scroll đến nó
            console.log(
              '[ProductList] Product now in displayedProducts after loadMore, scrolling to:',
              productIdToScroll
            );
            this.scrollToProductWithRetry(productIdToScroll, savedState.scrollY || undefined, 0);
          }
        }, 50); // Delay ngắn để DOM render xong
      }
      // Nếu không có productId đang chờ scroll, không scroll (giữ nguyên vị trí scroll hiện tại)
    }
  }

  updateDisplayedProducts(): void {
    // Server-side pagination: update limit and reload
    this.currentFilters.limit = this.itemsPerPage;
    this.loadProducts();
  }

  // -----------------------------
  //  Active filters management
  // -----------------------------
  removeFilter(filter: { type: string; value: string }): void {
    switch (filter.type) {
      case 'category':
        this.selectedCategories = this.selectedCategories.filter((c) => c !== filter.value);
        break;
      case 'brand':
        break;
      case 'promotion':
        this.selectedPromotions = this.selectedPromotions.filter((p) => p !== filter.value);
        break;
      case 'color':
        this.selectedColors = this.selectedColors.filter((c) => c !== filter.value);
        break;
      case 'rating':
        this.selectedRating = null;
        break;
      case 'price':
        this.minPrice = this.initialMinPrice;
        this.maxPrice = this.initialMaxPrice;
        this.priceRange = [this.initialMinPrice, this.initialMaxPrice];
        break;
    }
    this.applyFilters();
  }

  updateActiveFilters(): void {
    this.activeFilters = [];

    // KHÔNG thêm categories và subcategories vào activeFilters
    // Chỉ hiển thị filter từ filter-section (price, rating, promotion, color)

    this.selectedPromotions.forEach((promotion) => {
      this.activeFilters.push({
        type: 'promotion',
        value: promotion,
        label: promotion,
      });
    });

    this.selectedColors.forEach((color) => {
      this.activeFilters.push({
        type: 'color',
        value: color,
        label: color,
      });
    });

    if (this.selectedRating !== null) {
      this.activeFilters.push({
        type: 'rating',
        value: this.selectedRating.toString(),
        label: this.selectedRating === 5 ? '5 sao' : `${this.selectedRating} sao trở lên`,
      });
    }

    // Chỉ hiển thị filter chip giá nếu người dùng đã thay đổi khoảng giá
    if (this.minPrice !== this.initialMinPrice || this.maxPrice !== this.initialMaxPrice) {
      this.activeFilters.push({
        type: 'price',
        value: `${this.minPrice}-${this.maxPrice}`,
        label: `${this.formatPrice(this.minPrice)} - ${this.formatPrice(this.maxPrice)}`,
      });
    }
  }

  getActiveFilters(): Array<{ type: string; value: string; label: string }> {
    return this.activeFilters;
  }

  // -----------------------------
  // 🎯 Sort Methods
  // -----------------------------
  onSortChange(sortValue: string): void {
    if (sortValue === 'newest' || sortValue === 'bestseller') {
      if (
        (sortValue === 'newest' && this.categorySort === 'newest') ||
        (sortValue === 'bestseller' && this.categorySort === 'bestseller')
      ) {
        // Nếu đang chọn cùng loại, bỏ chọn
        this.categorySort = 'name';
        // Reset priceSort về mặc định khi bỏ chọn category sort
        this.priceSort = 'price-low';
      } else {
        // Chọn loại mới, reset categorySort và priceSort
        this.categorySort = sortValue;
        // Reset priceSort về mặc định khi chọn category sort
        this.priceSort = 'price-low';
      }
    }
    console.log('📊 [Sort] Category sort changed:', this.categorySort);
    console.log('💰 [Sort] Price sort:', this.priceSort);
    this.updateSortOption();
    this.sortProducts();
  }

  togglePriceSort(): void {
    // Khi chọn price sort, reset categorySort về 'name' (không active)
    this.categorySort = 'name';

    // Toggle price sort
    if (this.priceSort === 'price-low') {
      this.priceSort = 'price-high';
    } else {
      this.priceSort = 'price-low';
    }
    console.log('💰 [Sort] Price sort toggled:', this.priceSort);
    console.log('💰 [Sort] Category sort reset to:', this.categorySort);
    this.updateSortOption();
    this.sortProducts();
  }

  updateSortOption(): void {
    // Không cần set sortOption nữa vì sortProducts() sẽ xử lý kết hợp cả hai
    // Giữ lại để tương thích với code cũ
    if (this.categorySort !== 'name') {
      this.sortOption = this.categorySort;
    } else {
      this.sortOption = this.priceSort;
    }
  }

  getPriceSortText(): string {
    if (this.priceSort === 'price-low') {
      return 'Giá thấp đến cao';
    } else if (this.priceSort === 'price-high') {
      return 'Giá cao đến thấp';
    }
    return 'Giá thấp đến cao';
  }

  sortProducts(): void {
    // Map frontend sort options to backend sort values
    let backendSort = 'newest';

    if (this.categorySort === 'newest') {
      backendSort = 'newest';
    } else if (this.categorySort === 'bestseller') {
      backendSort = 'bestseller';
    } else if (this.priceSort === 'price-low') {
      backendSort = 'price-asc';
    } else if (this.priceSort === 'price-high') {
      backendSort = 'price-desc';
    }

    // Update current filters and reload
    if (this.currentFilters.sort !== backendSort) {
      this.currentFilters.sort = backendSort;
      this.currentFilters.page = 1; // Reset to page 1 when sorting changes
      this.loadProducts();
    }
  }

  // -----------------------------
  //  Các method điều khiển filter sections
  // -----------------------------
  toggleSection(section: string): void {
    this.expandedSections[section] = !this.expandedSections[section];

    // Re-check sidebar height after animation completes
    setTimeout(() => this.updateSidebarHeight(), 300);
  }

  // -----------------------------
  //  Các method xử lý filter changes
  // -----------------------------

  onPromotionChange(promotion: string, checked: boolean): void {
    if (checked) {
      this.selectedPromotions.push(promotion);
    } else {
      this.selectedPromotions = this.selectedPromotions.filter((p) => p !== promotion);
    }
    this.applyFilters();
  }

  onColorChange(color: string, checked: boolean): void {
    if (checked) {
      this.selectedColors.push(color);
    } else {
      this.selectedColors = this.selectedColors.filter((c) => c !== color);
    }
    this.applyFilters();
  }

  onRatingChange(rating: number): void {
    if (this.selectedRating === rating) {
      this.selectedRating = null;
    } else {
      this.selectedRating = rating;
    }
    this.applyFilters();
  }

  // -----------------------------
  // 🎯 Helper Methods
  // -----------------------------

  /**
   * Kiểm tra xem các sản phẩm ĐANG ĐƯỢC LỌC có màu sắc không
   * Nếu không có sản phẩm nào có màu trong filtered set => ẩn bộ lọc màu sắc
   */
  hasColors(): boolean {
    // Lấy sản phẩm đã được lọc theo category/subcategory (KHÔNG bao gồm color filter và search query)
    // Sidebar luôn hiển thị tất cả categories, không bị ảnh hưởng bởi search query
    const baseProducts = this.products.filter((p) => {
      // Category filter (chỉ áp dụng khi không có search query hoặc có category được chọn)
      if (this.selectedCategories.length > 0 && !this.selectedCategories.includes(p.Category)) {
        return false;
      }

      // Subcategory filter (chỉ áp dụng khi không có search query hoặc có subcategory được chọn)
      if (
        this.selectedSubcategories.length > 0 &&
        !this.selectedSubcategories.includes(p.Subcategory)
      ) {
        return false;
      }

      // KHÔNG filter theo search query ở đây - sidebar luôn hiển thị tất cả categories
      return true;
    });

    // Kiểm tra xem có sản phẩm nào có màu hợp lệ không
    const hasValidColors = baseProducts.some((p) => {
      // Color phải là string và không phải 'NaN' hoặc object
      if (!p.Color) return false;
      if (typeof p.Color === 'object') return false; // Skip { "$numberDouble": "NaN" }
      if (typeof p.Color !== 'string') return false;
      if (p.Color === 'NaN' || p.Color.trim() === '') return false;
      return true;
    });

    console.log('hasColors() check:', {
      currentView: this.currentView,
      totalProducts: this.products.length,
      filteredProducts: baseProducts.length,
      selectedCategories: this.selectedCategories,
      selectedSubcategories: this.selectedSubcategories,
      hasValidColors: hasValidColors,
      sampleColorsFound: baseProducts
        .filter((p) => p.Color && typeof p.Color === 'string' && p.Color !== 'NaN')
        .slice(0, 3)
        .map((p) => ({ name: p.ProductName, color: p.Color })),
    });

    return hasValidColors;
  }

  /**
   * Get available colors from currently filtered products (based on category/subcategory only)
   * This ensures the color filter only shows colors that actually exist in the visible products
   */
  getAvailableColors(): string[] {
    // Lấy sản phẩm đã được lọc theo category/subcategory (KHÔNG bao gồm color filter và search query)
    // Sidebar luôn hiển thị tất cả categories, không bị ảnh hưởng bởi search query
    const baseProducts = this.products.filter((p) => {
      // Category filter (chỉ áp dụng khi không có search query hoặc có category được chọn)
      if (this.selectedCategories.length > 0 && !this.selectedCategories.includes(p.Category)) {
        return false;
      }

      // Subcategory filter (chỉ áp dụng khi không có search query hoặc có subcategory được chọn)
      if (
        this.selectedSubcategories.length > 0 &&
        !this.selectedSubcategories.includes(p.Subcategory)
      ) {
        return false;
      }

      // KHÔNG filter theo search query ở đây - sidebar luôn hiển thị tất cả categories
      return true;
    });

    // Extract unique colors from filtered products only
    const allColors = baseProducts
      .map((p) => p.Color)
      .filter((color) => {
        // Chỉ lấy color là string và không phải 'NaN'
        if (!color) return false;
        if (typeof color === 'object') return false; // Skip { "$numberDouble": "NaN" }
        if (typeof color !== 'string') return false;
        if (color === 'NaN' || color.trim() === '') return false;
        return true;
      })
      .flatMap((color) => color.split(',').map((c: string) => c.trim()))
      .filter((color) => color.length > 0);

    const availableColors = [...new Set(allColors)].sort();

    console.log('getAvailableColors():', {
      totalProducts: this.products.length,
      filteredProducts: baseProducts.length,
      availableColorsCount: availableColors.length,
      availableColors: availableColors,
    });

    return availableColors;
  }

  /**
   * Kiểm tra xem có sản phẩm nào có khuyến mãi trong filtered set không
   */
  hasPromotions(): boolean {
    // Lấy sản phẩm đã được lọc theo category/subcategory (KHÔNG bao gồm promotion filter và search query)
    // Sidebar luôn hiển thị tất cả categories, không bị ảnh hưởng bởi search query
    const baseProducts = this.products.filter((p) => {
      // Category filter (chỉ áp dụng khi không có search query hoặc có category được chọn)
      if (this.selectedCategories.length > 0 && !this.selectedCategories.includes(p.Category)) {
        return false;
      }

      // Subcategory filter (chỉ áp dụng khi không có search query hoặc có subcategory được chọn)
      if (
        this.selectedSubcategories.length > 0 &&
        !this.selectedSubcategories.includes(p.Subcategory)
      ) {
        return false;
      }

      // KHÔNG filter theo search query ở đây - sidebar luôn hiển thị tất cả categories
      return true;
    });

    // Kiểm tra xem có sản phẩm nào có promotion không
    const hasAnyPromotions = baseProducts.some((p) => {
      return p.hasPromotion === true;
    });

    console.log('🎁 hasPromotions() check:', {
      totalProducts: this.products.length,
      filteredProducts: baseProducts.length,
      hasAnyPromotions: hasAnyPromotions,
      samplePromotionsFound: baseProducts
        .filter((p) => p.hasPromotion)
        .slice(0, 3)
        .map((p) => ({ name: p.ProductName, promotionType: p.promotionType })),
    });

    return hasAnyPromotions;
  }

  /**
   * Get available promotions from currently filtered products
   */
  getAvailablePromotions(): string[] {
    // Lấy sản phẩm đã được lọc theo category/subcategory (KHÔNG bao gồm search query)
    // Sidebar luôn hiển thị tất cả categories, không bị ảnh hưởng bởi search query
    const baseProducts = this.products.filter((p) => {
      // Category filter (chỉ áp dụng khi không có search query hoặc có category được chọn)
      if (this.selectedCategories.length > 0 && !this.selectedCategories.includes(p.Category)) {
        return false;
      }
      // Subcategory filter (chỉ áp dụng khi không có search query hoặc có subcategory được chọn)
      if (
        this.selectedSubcategories.length > 0 &&
        !this.selectedSubcategories.includes(p.Subcategory)
      ) {
        return false;
      }
      // KHÔNG filter theo search query ở đây - sidebar luôn hiển thị tất cả categories
      return true;
    });

    const availablePromotions: string[] = [];

    // Kiểm tra xem có sản phẩm nào có normal promotion không
    const hasNormalPromotion = baseProducts.some((p) => {
      if (!p.hasPromotion) return false;
      if (Array.isArray(p.promotionType)) {
        return p.promotionType.includes('normal');
      }
      return p.promotionType === 'normal';
    });
    if (hasNormalPromotion) {
      availablePromotions.push('Giảm giá');
    }

    // Kiểm tra xem có sản phẩm nào có buy1get1 promotion không
    const hasBuy1Get1 = baseProducts.some((p) => {
      if (!p.hasPromotion) return false;
      if (Array.isArray(p.promotionType)) {
        return p.promotionType.includes('buy1get1');
      }
      return p.promotionType === 'buy1get1';
    });
    if (hasBuy1Get1) {
      availablePromotions.push('Mua 1 tặng 1');
    }

    console.log('🎁 getAvailablePromotions():', {
      totalProducts: this.products.length,
      filteredProducts: baseProducts.length,
      availablePromotionsCount: availablePromotions.length,
      availablePromotions: availablePromotions,
    });

    return availablePromotions;
  }

  /**
   * Kiểm tra xem sản phẩm có khuyến mãi Mua 1 tặng 1 không
   */
  hasBuy1Get1Promotion(product: Product): boolean {
    if (!product.hasPromotion || !product.promotionType) {
      return false;
    }
    if (Array.isArray(product.promotionType)) {
      return product.promotionType.includes('buy1get1');
    }
    return product.promotionType === 'buy1get1';
  }

  /**
   * Kiểm tra xem sản phẩm có khớp với màu đã chọn không
   * Hỗ trợ sản phẩm có nhiều màu (format: "màu A, màu B, màu C")
   *
   * Ví dụ:
   * - Sản phẩm: "Đỏ, Vàng, Cam"
   * - Filter chọn: ["Đỏ"] =>  Hiển thị (vì "Đỏ" nằm trong danh sách)
   * - Filter chọn: ["Vàng"] =>  Hiển thị (vì "Vàng" nằm trong danh sách)
   * - Filter chọn: ["Xanh"] =>  Ẩn (vì "Xanh" không nằm trong danh sách)
   */
  private productMatchesColorFilter(product: Product): boolean {
    if (this.selectedColors.length === 0) {
      return true; // Không có filter màu => pass tất cả sản phẩm
    }

    const productColor = product.Color || '';
    if (typeof productColor === 'string' && productColor !== 'NaN' && productColor.length > 0) {
      // Split màu sắc theo dấu phẩy và trim (ví dụ: "Đỏ, Vàng, Cam" => ["Đỏ", "Vàng", "Cam"])
      const productColors = productColor.split(',').map((c) => c.trim());

      // Kiểm tra xem có bất kỳ màu nào được chọn nằm trong danh sách màu của sản phẩm không
      const hasMatch = this.selectedColors.some((selectedColor) =>
        productColors.includes(selectedColor)
      );

      // Debug log (có thể comment out sau khi test xong)
      if (this.selectedColors.length > 0) {
        console.log(
          `Color filter check:`,
          `Product colors: [${productColors.join(', ')}]`,
          `| Selected: [${this.selectedColors.join(', ')}]`,
          `| Match: ${hasMatch ? 'Yes' : 'No'}`
        );
      }

      return hasMatch;
    }

    // Nếu sản phẩm không có màu hợp lệ thì không hiển thị khi filter theo màu
    return false;
  }

  getCurrentTitle(): string {
    // Ưu tiên hiển thị "Kết quả tìm kiếm" nếu có search query
    if (this.searchQuery && this.searchQuery.trim() !== '') {
      return `Kết quả tìm kiếm: "${this.searchQuery}"`;
    }
    // Khi ở subcategories view, luôn hiển thị category
    if (this.currentView === 'subcategories' && this.currentCategory) {
      return this.currentCategory;
    }
    // Fallback cho các trường hợp khác
    if (this.currentSubcategory) {
      return this.currentSubcategory;
    } else if (this.currentCategory) {
      return this.currentCategory;
    }
    return 'Sản phẩm';
  }

  updatePageTitle(): void {
    const title = this.getCurrentTitle();
    document.title = `${title} - VGreen`;
  }

  getCurrentCategoryTitle(): string {
    // Ưu tiên hiển thị "Kết quả tìm kiếm" nếu có search query
    if (this.searchQuery && this.searchQuery.trim() !== '') {
      return `Kết quả tìm kiếm: "${this.searchQuery}"`;
    }
    if (this.currentSubcategory) {
      return this.currentSubcategory;
    } else if (this.currentCategory) {
      return this.currentCategory;
    }
    return 'Sản phẩm';
  }

  getCurrentCategoryCount(): string {
    const productCount = this.filteredProducts.length;
    return `(có ${productCount} sản phẩm)`;
  }

  addToCart(product: Product): void {
    // Kiểm tra user đã đăng nhập chưa
    const token = localStorage.getItem('token');
    if (!token) {
      // Mở popup đăng nhập nếu chưa đăng nhập
      this.authPopupService.openPopup('login');
      return;
    }

    // Chuyển đổi Product sang CartItem format
    // Nếu có promotion: price là giá sau giảm, originalPrice là giá gốc
    // Nếu không có promotion: price là giá bình thường, originalPrice là undefined
    const hasPromotion = product.hasPromotion || false;
    // Chỉ set originalPrice khi có promotion VÀ có OriginalPrice hợp lệ (lớn hơn price)
    const originalPrice =
      hasPromotion && product.OriginalPrice && product.OriginalPrice > product.Price
        ? product.OriginalPrice
        : undefined;

    const cartItem = {
      id: product.sku || parseInt(product._id.replace(/\D/g, '')) || Date.now(), // Sử dụng sku hoặc parse từ _id
      sku: product.sku || product._id, //  Thêm SKU cho backend
      name: product.ProductName,
      productName: product.ProductName, //  Thêm productName cho backend
      price: product.Price, // Giá hiện tại (có thể là giá sau giảm nếu có promotion)
      image: this.getProductImage(product), // Lấy ảnh đầu tiên từ array
      category: product.Category,
      subcategory: product.Subcategory,
      unit: product.Unit,
      selected: true,
      originalPrice: originalPrice,
      hasPromotion: hasPromotion,
    };

    // Thêm vào giỏ hàng thông qua CartService
    this.cartService.addToCart(cartItem);
    console.log('Added to cart:', product.ProductName);
  }

  goToProductDetail(product: Product | string): void {
    // Lưu product ID/SKU để scroll đến sau khi quay lại
    let productId = '';
    if (typeof product === 'object' && product !== null) {
      productId = product.sku || product._id || '';
    } else if (typeof product === 'string') {
      productId = product;
    }

    // Lưu scroll position và state trước khi navigate (bao gồm productId)
    this.saveScrollState(productId);

    // Nếu nhận được object Product, ưu tiên dùng SKU, fallback về _id
    if (typeof product === 'object' && product !== null) {
      const id = product.sku || product._id || '';
      if (id) {
        this.router.navigate(['/product-detail', id]);
      } else {
        console.error('Cannot navigate: Product has no SKU or _id', product);
      }
    } else if (typeof product === 'string') {
      // Nếu nhận được string, dùng trực tiếp
      this.router.navigate(['/product-detail', product]);
    } else {
      console.error('Invalid product parameter:', product);
    }
  }

  // -----------------------------
  // 🎯 Scroll State Management (E-commerce UX)
  // -----------------------------
  private saveScrollState(selectedProductId?: string): void {
    if (typeof window === 'undefined') return;

    const scrollState = {
      scrollY: window.scrollY || window.pageYOffset || 0,
      selectedProductId: selectedProductId || '', // Lưu product ID để scroll đến sau khi quay lại
      currentView: this.currentView,
      currentCategory: this.currentCategory,
      currentSubcategory: this.currentSubcategory,
      breadcrumb: this.breadcrumb,
      searchQuery: this.searchQuery,
      selectedCategories: this.selectedCategories,
      selectedSubcategories: this.selectedSubcategories,
      selectedPromotions: this.selectedPromotions,
      selectedColors: this.selectedColors,
      selectedRating: this.selectedRating,
      minPrice: this.minPrice,
      maxPrice: this.maxPrice,
      categorySort: this.categorySort,
      priceSort: this.priceSort,
      itemsPerPage: this.itemsPerPage, // Lưu số lượng sản phẩm đã hiển thị
      displayedProductsCount: this.displayedProducts.length,
      timestamp: Date.now(),
    };

    localStorage.setItem('productListScrollState', JSON.stringify(scrollState));
    // Set flag để biết đang navigate đến product-detail
    localStorage.setItem('navigatingToProductDetail', 'true');
    console.log('[ProductList] Saved scroll state:', scrollState);
  }

  private restoreScrollState(): void {
    if (typeof window === 'undefined') return;

    const savedStateStr = localStorage.getItem('productListScrollState');
    if (!savedStateStr) {
      console.log('[ProductList] No saved scroll state found');
      return;
    }

    try {
      const savedState = JSON.parse(savedStateStr);

      // Chỉ restore nếu state được lưu trong vòng 5 phút (tránh restore state cũ)
      const stateAge = Date.now() - savedState.timestamp;
      if (stateAge > 5 * 60 * 1000) {
        console.log('[ProductList] Saved state is too old, clearing it');
        localStorage.removeItem('productListScrollState');
        localStorage.removeItem('navigatingToProductDetail');
        return;
      }

      // Kiểm tra xem có phải quay lại từ product-detail không
      // Check bằng flag và referrer - PHẢI CHECK TRƯỚC query params
      const navigatingFlag = localStorage.getItem('navigatingToProductDetail');
      const isReturningFromDetail =
        navigatingFlag === 'true' ||
        (document.referrer && document.referrer.includes('/product-detail'));

      if (!isReturningFromDetail) {
        // Nếu không phải quay lại từ product-detail, kiểm tra query params
        // Nếu có query params thì đây là fresh navigation, không restore
        const currentUrl = window.location.href;
        const hasQueryParams =
          currentUrl.includes('?') &&
          (currentUrl.includes('search=') ||
            currentUrl.includes('category=') ||
            currentUrl.includes('sort=') ||
            currentUrl.includes('promotion='));

        if (hasQueryParams) {
          console.log(
            '[ProductList] Fresh navigation with query params detected, skipping scroll state restore'
          );
          // Clear saved state vì đây là fresh navigation với query params
          localStorage.removeItem('productListScrollState');
          localStorage.removeItem('navigatingToProductDetail');
          return;
        } else {
          // Fresh navigation không có query params, clear state
          console.log('[ProductList] Not returning from product-detail, clearing saved state');
          localStorage.removeItem('productListScrollState');
          localStorage.removeItem('navigatingToProductDetail');
          return;
        }
      }

      // Nếu đến đây thì đang quay lại từ product-detail
      // Vẫn restore dù có query params (vì query params được set khi navigate từ product-detail về)

      // Clear flag sau khi đã check
      localStorage.removeItem('navigatingToProductDetail');

      console.log('[ProductList] Restoring scroll state:', savedState);

      // Restore state
      this.currentView = savedState.currentView || this.currentView;
      this.currentCategory = savedState.currentCategory || this.currentCategory;
      this.currentSubcategory = savedState.currentSubcategory || this.currentSubcategory;
      this.breadcrumb = savedState.breadcrumb || this.breadcrumb;
      this.searchQuery = savedState.searchQuery || this.searchQuery;
      this.selectedCategories = savedState.selectedCategories || this.selectedCategories;
      this.selectedSubcategories = savedState.selectedSubcategories || this.selectedSubcategories;
      this.selectedPromotions = savedState.selectedPromotions || this.selectedPromotions;
      this.selectedColors = savedState.selectedColors || this.selectedColors;
      this.selectedRating =
        savedState.selectedRating !== null ? savedState.selectedRating : this.selectedRating;
      this.minPrice = savedState.minPrice !== undefined ? savedState.minPrice : this.minPrice;
      this.maxPrice = savedState.maxPrice !== undefined ? savedState.maxPrice : this.maxPrice;
      this.categorySort = savedState.categorySort || this.categorySort;
      this.priceSort = savedState.priceSort || this.priceSort;

      // Restore itemsPerPage nếu có (để đảm bảo sản phẩm đã chọn nằm trong displayedProducts)
      if (savedState.itemsPerPage && savedState.itemsPerPage > 24) {
        this.itemsPerPage = savedState.itemsPerPage;
        console.log('[ProductList] Restored itemsPerPage to:', this.itemsPerPage);
      }

      // Apply filters với state đã restore
      // Bước 1: Apply filters (sẽ gọi sortProducts -> updateDisplayedProducts)
      setTimeout(() => {
        this.applyFilters();
        this.updatePageTitle();

        // Bước 2: Đợi Angular change detection và DOM render xong
        // applyFilters() -> sortProducts() -> updateDisplayedProducts()
        // Cần đợi đủ lâu để displayedProducts được cập nhật và DOM render
        setTimeout(() => {
          // Bước 3: Kiểm tra xem sản phẩm đã chọn có trong displayedProducts không
          // Nếu không, cần load thêm sản phẩm
          if (savedState.selectedProductId && savedState.selectedProductId.trim() !== '') {
            const productIndex = this.filteredProducts.findIndex(
              (p) =>
                p.sku === savedState.selectedProductId || p._id === savedState.selectedProductId
            );

            if (productIndex >= 0) {
              // Sản phẩm có trong filteredProducts
              // Kiểm tra xem nó có trong displayedProducts không
              const isInDisplayed = this.displayedProducts.some(
                (p) =>
                  p.sku === savedState.selectedProductId || p._id === savedState.selectedProductId
              );

              if (!isInDisplayed && productIndex >= this.itemsPerPage) {
                // Sản phẩm nằm ngoài displayedProducts, cần load thêm
                // Tính số lượng cần load: productIndex + 1 (để đảm bảo sản phẩm được hiển thị)
                const neededItems = Math.ceil((productIndex + 1) / 24) * 24; // Làm tròn lên bội số của 24
                this.itemsPerPage = neededItems;
                this.updateDisplayedProducts();
                console.log(
                  `[ProductList] Product at index ${productIndex}, loading ${neededItems} items to display it`
                );
                // Đợi DOM render xong sau khi load thêm sản phẩm
                // Sử dụng setTimeout để đảm bảo Angular đã update DOM
                setTimeout(() => {
                  this.scrollToProductAfterLoad(savedState.selectedProductId, savedState.scrollY);
                }, 300);
                return; // Return sớm vì đã xử lý scroll trong scrollToProductAfterLoad
              }
            }
          }

          // Bước 4: Sử dụng requestAnimationFrame để đảm bảo DOM đã render hoàn toàn
          requestAnimationFrame(() => {
            // Đợi thêm 1 frame nữa để chắc chắn
            requestAnimationFrame(() => {
              // Ưu tiên scroll đến sản phẩm vừa chọn nếu có
              if (savedState.selectedProductId && savedState.selectedProductId.trim() !== '') {
                console.log(
                  '[ProductList] Attempting to scroll to product:',
                  savedState.selectedProductId
                );
                console.log(
                  '[ProductList] Displayed products count:',
                  this.displayedProducts.length
                );
                // Thử scroll với retry mechanism
                this.scrollToProductWithRetry(savedState.selectedProductId, savedState.scrollY, 0);
              } else {
                // Fallback về scroll position cũ nếu không có product ID
                const scrollY = savedState.scrollY || 0;
                if (scrollY > 0) {
                  window.scrollTo({
                    top: scrollY,
                    behavior: 'smooth',
                  });
                  console.log(
                    '[ProductList] Restored scroll position to:',
                    scrollY,
                    'with smooth animation'
                  );
                }
              }
            });
          });
        }, 500); // Tăng delay lên 500ms để đảm bảo DOM đã render hoàn toàn
      }, 200);
    } catch (error) {
      console.error('[ProductList] Error restoring scroll state:', error);
      localStorage.removeItem('productListScrollState');
    }
  }

  /**
   * Scroll đến sản phẩm sau khi đã load thêm sản phẩm
   * @param productId - SKU hoặc _id của sản phẩm
   * @param fallbackScrollY - Vị trí scroll fallback nếu không tìm thấy sản phẩm
   */
  private scrollToProductAfterLoad(productId: string, fallbackScrollY?: number): void {
    // Sử dụng requestAnimationFrame để đảm bảo DOM đã render xong
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.scrollToProductWithRetry(productId, fallbackScrollY, 0);
      });
    });
  }

  /**
   * Scroll đến sản phẩm cụ thể với retry mechanism (tham khảo logic từ blog)
   * @param productId - SKU hoặc _id của sản phẩm
   * @param fallbackScrollY - Vị trí scroll fallback nếu không tìm thấy sản phẩm
   * @param retryCount - Số lần đã retry
   */
  private scrollToProductWithRetry(
    productId: string,
    fallbackScrollY?: number,
    retryCount: number = 0
  ): void {
    if (typeof document === 'undefined' || !productId || productId.trim() === '') {
      console.log('[ProductList] Invalid productId, using fallback scroll');
      // Fallback về scroll position cũ nếu không có product ID
      if (fallbackScrollY && fallbackScrollY > 0) {
        window.scrollTo({
          top: fallbackScrollY,
          behavior: 'smooth',
        });
      }
      return;
    }

    console.log(`[ProductList] Attempting to find product card (retry ${retryCount}):`, productId);

    // Kiểm tra xem product có tồn tại trong filteredProducts không
    const productExists = this.filteredProducts.some(
      (p) => p.sku === productId || p._id === productId
    );
    if (!productExists) {
      console.log('[ProductList] Product not found in filteredProducts:', productId);
      if (fallbackScrollY && fallbackScrollY > 0) {
        window.scrollTo({
          top: fallbackScrollY,
          behavior: 'smooth',
        });
      }
      return;
    }

    // Kiểm tra xem product có trong displayedProducts chưa, nếu chưa thì load thêm
    const productInDisplayed = this.displayedProducts.some(
      (p) => p.sku === productId || p._id === productId
    );
    if (!productInDisplayed && this.hasMoreProducts) {
      // Product chưa được load, cần load thêm
      console.log('[ProductList] Product not in displayed products, loading more...');
      const productIndex = this.filteredProducts.findIndex(
        (p) => p.sku === productId || p._id === productId
      );

      if (productIndex >= 0) {
        // Tính toán số lượng product cần load để hiển thị product này
        const neededCount = Math.min(productIndex + 1, this.filteredProducts.length);
        if (neededCount > this.itemsPerPage) {
          // Tính số lượng items cần load (làm tròn lên bội số của 24)
          const neededItems = Math.ceil(neededCount / 24) * 24;
          this.itemsPerPage = neededItems;
          this.updateDisplayedProducts();
          // Sau khi load thêm, retry scroll
          setTimeout(() => {
            this.scrollToProductWithRetry(productId, fallbackScrollY, retryCount);
          }, 100);
          return;
        }
      }
    }

    // Tìm product card trong DOM bằng data attribute
    // Thử nhiều cách tìm để đảm bảo tìm được
    let targetCard: HTMLElement | null = null;

    // Cách 1: Tìm bằng data-product-id attribute
    targetCard = document.querySelector(
      `.product-card[data-product-id="${productId}"]`
    ) as HTMLElement;

    // Cách 2: Nếu không tìm thấy, thử tìm trong displayedProducts và match index
    if (!targetCard) {
      const productIndex = this.displayedProducts.findIndex(
        (p) => p.sku === productId || p._id === productId
      );
      if (productIndex >= 0) {
        const allCards = document.querySelectorAll('.product-card');
        if (productIndex < allCards.length) {
          targetCard = allCards[productIndex] as HTMLElement;
          console.log(`[ProductList] Found product by index: ${productIndex}`);
        }
      }
    }

    if (targetCard) {
      // Scroll đến product card với offset để không bị che bởi header
      const headerOffset = 100; // Offset để không bị che bởi header/sticky elements
      const elementPosition = targetCard.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

      console.log('[ProductList] Found product card, scrolling to:', offsetPosition);

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });

      // Highlight product card
      targetCard.classList.add('product-highlight');
      setTimeout(() => {
        targetCard?.classList.remove('product-highlight');
      }, 2000);

      console.log('[ProductList] Successfully scrolled to product:', productId);

      // Clear selectedProductId khỏi saved state sau khi scroll thành công (chỉ khi retryCount === 0)
      // Để tránh scroll lại khi user chủ động click "Xem thêm"
      if (retryCount === 0) {
        const savedStateStr = localStorage.getItem('productListScrollState');
        if (savedStateStr) {
          try {
            const savedState = JSON.parse(savedStateStr);
            if (savedState.selectedProductId === productId) {
              // Clear selectedProductId để không scroll lại khi click "Xem thêm"
              savedState.selectedProductId = '';
              localStorage.setItem('productListScrollState', JSON.stringify(savedState));
              console.log(
                '[ProductList] Cleared selectedProductId from saved state after successful scroll'
              );
            }
          } catch (e) {
            console.error('[ProductList] Error clearing selectedProductId:', e);
          }
        }
      }
    } else {
      // Retry nếu chưa tìm thấy và chưa quá 5 lần (tối đa 1 giây delay)
      if (retryCount < 5) {
        console.log(
          `[ProductList] Product card not found, retrying in 200ms... (${retryCount + 1}/5)`
        );
        setTimeout(() => {
          this.scrollToProductWithRetry(productId, fallbackScrollY, retryCount + 1);
        }, 200); // Retry sau 200ms
      } else {
        // Fallback về scroll position cũ nếu không tìm thấy sau nhiều lần retry
        console.log(
          '[ProductList] Product not found after 5 retries, using fallback scroll position'
        );
        if (fallbackScrollY && fallbackScrollY > 0) {
          window.scrollTo({
            top: fallbackScrollY,
            behavior: 'smooth',
          });
          console.log('[ProductList] Restored scroll position to:', fallbackScrollY);
        }
      }
    }
  }

  /**
   * Scroll đến sản phẩm cụ thể dựa trên ID/SKU (wrapper method)
   * @param productId - SKU hoặc _id của sản phẩm
   * @param fallbackScrollY - Vị trí scroll fallback nếu không tìm thấy sản phẩm
   */
  private scrollToProduct(productId: string, fallbackScrollY?: number): void {
    this.scrollToProductWithRetry(productId, fallbackScrollY, 0);
  }

  // -----------------------------
  // 🎯 Favorite Methods
  // -----------------------------
  toggleFavorite(product: Product): void {
    // Kiểm tra user đã đăng nhập chưa
    const token = localStorage.getItem('token');
    if (!token) {
      // Mở popup đăng nhập nếu chưa đăng nhập
      this.authPopupService.openPopup('login');
      return;
    }

    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) {
      // Mở popup đăng nhập nếu không tìm thấy user
      this.authPopupService.openPopup('login');
      return;
    }

    // Lấy CustomerID từ localStorage
    const userDataStr = localStorage.getItem('user');
    let customerID: string = '';

    if (userDataStr) {
      try {
        const userData = JSON.parse(userDataStr);
        customerID = userData.CustomerID || '';
      } catch (error) {
        console.error('Error parsing user data:', error);
      }
    }

    // Fallback: thử lấy từ currentUser
    if (!customerID && currentUser) {
      customerID = (currentUser as any).CustomerID || '';
    }

    if (!customerID) {
      console.error('Không tìm thấy CustomerID hợp lệ');
      return;
    }

    const sku = product.sku;
    const productName = product.ProductName;

    // Toggle wishlist using WishlistService
    this.wishlistService.toggleWishlist(customerID, sku, productName).subscribe({
      next: (isAdded) => {
        // Update local array for UI
        const index = this.favoriteProducts.indexOf(sku);
        if (isAdded && index === -1) {
          this.favoriteProducts.push(sku);
        } else if (!isAdded && index > -1) {
          this.favoriteProducts.splice(index, 1);
        }
      },
      error: (error) => {
        console.error('Lỗi khi toggle wishlist:', error);
      },
    });
  }

  isFavorite(product: Product): boolean {
    const wishlist = this.wishlistService.getCurrentWishlist();
    return wishlist.some((item) => item.sku === product.sku);
  }

  // -----------------------------
  // 🎯 Promotion Methods
  // -----------------------------
  private applyPromotionsToProducts(products: any[], promotions: any[], targets: any[]): any[] {
    console.log(` [ProductList] Applying promotions to ${products.length} products...`);
    console.log(
      `   Available promotions: ${promotions
        .map((p: any) => `${p.code} (${p.discount_type})`)
        .join(', ')}`
    );
    console.log(`   Available targets: ${targets.length}`);

    let matchedCount = 0;

    const result = products.map((product) => {
      // Tìm tất cả promotion targets áp dụng cho product này
      const applicableTargets = targets.filter((target) => {
        return this.isProductMatchTarget(product, target);
      });

      if (applicableTargets.length === 0) {
        return { ...product, hasPromotion: false };
      }

      // Tìm tất cả promotions tương ứng
      const applicablePromotions = applicableTargets
        .map((target) => promotions.find((p) => p.promotion_id === target.promotion_id))
        .filter((p): p is any => p !== undefined);

      if (applicablePromotions.length === 0) {
        return { ...product, hasPromotion: false };
      }

      // Xác định các loại promotion (có thể có cả normal và buy1get1)
      const promotionTypes: ('normal' | 'buy1get1')[] = [];
      let normalPromotion: any = null;

      applicablePromotions.forEach((p) => {
        if (p.discount_type === 'buy1get1') {
          promotionTypes.push('buy1get1');
        } else {
          promotionTypes.push('normal');
          // Ưu tiên lưu promotion normal đầu tiên để tính giá
          if (!normalPromotion) {
            normalPromotion = p;
          }
        }
      });

      // Nếu chỉ có 1 loại, trả về string, nếu có nhiều loại trả về array
      const promotionType: 'normal' | 'buy1get1' | ('normal' | 'buy1get1')[] =
        promotionTypes.length === 1 ? promotionTypes[0] : promotionTypes;

      // Tính giá sau khuyến mãi (chỉ tính cho normal promotion, buy1get1 không giảm giá)
      let discountedPrice = product.price;
      let discountAmount = 0;
      let discountPercent = 0;

      if (normalPromotion) {
        discountedPrice = this.calculateDiscountedPrice(product.price, normalPromotion);
        discountAmount = product.price - discountedPrice;
        discountPercent = Math.round((discountAmount / product.price) * 100);
      }

      matchedCount++;

      // Chọn promotion đầu tiên để hiển thị tên (ưu tiên buy1get1)
      const displayPromotion =
        applicablePromotions.find((p) => p.discount_type === 'buy1get1') || applicablePromotions[0];

      return {
        ...product,
        hasPromotion: true,
        originalPrice: product.price,
        discountedPrice: discountedPrice,
        discountAmount: discountAmount,
        discountPercent: discountPercent,
        promotionName: displayPromotion.name,
        promotionCode: displayPromotion.code,
        promotionType: promotionType,
      };
    });

    console.log(` [ProductList] Matched ${matchedCount} products with promotions`);

    return result;
  }

  private isProductMatchTarget(product: any, target: any): boolean {
    const { target_type, target_ref } = target;

    switch (target_type) {
      case 'Category':
        return target_ref.includes(product.category);
      case 'Subcategory':
        return target_ref.includes(product.subcategory);
      case 'Brand':
        return target_ref.includes(product.brand);
      case 'Product':
        // Chuyển đổi cả product.sku và target_ref về string để so sánh chắc chắn
        const productSku = String(product.sku || '').trim();
        const targetSkus = target_ref.map((s: any) => String(s).trim());
        return targetSkus.includes(productSku);
      default:
        return false;
    }
  }

  private calculateDiscountedPrice(originalPrice: number, promotion: any): number {
    if (promotion.discount_type === 'percent') {
      const discountAmount = (originalPrice * promotion.discount_value) / 100;
      const maxDiscount = promotion.max_discount_value || Infinity;
      const actualDiscount = Math.min(discountAmount, maxDiscount);
      return originalPrice - actualDiscount;
    } else if (promotion.discount_type === 'fixed') {
      return Math.max(0, originalPrice - promotion.discount_value);
    }
    return originalPrice;
  }

  // -----------------------------
  // 🎯 Product Discount Methods
  // -----------------------------
  hasDiscount(product: Product): boolean {
    // Kiểm tra có hasPromotion
    if (!product || !product.hasPromotion) {
      return false;
    }

    // Phải có OriginalPrice và > 0
    if (!product.OriginalPrice || product.OriginalPrice <= 0) {
      return false;
    }

    // Phải có discountPercent và > 0
    const discountPercent = product.discountPercent || product.Discount || 0;
    if (!discountPercent || discountPercent <= 0) {
      return false;
    }

    // OriginalPrice phải lớn hơn Price (giá sau giảm)
    if (product.OriginalPrice <= product.Price) {
      return false;
    }

    return true;
  }

  getOriginalPrice(product: Product): number {
    return product.OriginalPrice || product.Price;
  }

  getDiscountPercent(product: Product): number {
    return product.discountPercent || product.Discount || 0;
  }

  // Get purchase count from product data
  getPurchaseCount(product: Product): string {
    // Trả về giá trị PurchaseCount từ JSON với format số có dấu phẩy
    const count = product.PurchaseCount || 0;
    return count.toLocaleString('vi-VN');
  }

  // Load reviews for products to calculate ratings
  loadReviewsForProducts(): void {
    if (this.products.length === 0) return;

    // Load reviews for all products in parallel (limit to first 100 to avoid too many requests)
    const productsToLoad = this.products.slice(0, 100);
    const reviewRequests = productsToLoad.map((product) =>
      this.http.get<any>(`${this.apiUrl}/reviews/${product.sku}`)
    );

    forkJoin(reviewRequests).subscribe({
      next: (responses) => {
        responses.forEach((response, index) => {
          const product = productsToLoad[index];
          if (response.success && response.data && response.data.reviews) {
            const reviews = response.data.reviews;
            // Calculate rating from reviews
            const totalRating = reviews.reduce(
              (sum: number, review: any) => sum + review.rating,
              0
            );
            const calculatedRating =
              reviews.length > 0 ? Math.round((totalRating / reviews.length) * 10) / 10 : 0;

            // Update product rating and review count
            product.Rating = calculatedRating;
            product.ReviewCount = reviews.length;
          } else {
            // No reviews found
            product.Rating = 0;
            product.ReviewCount = 0;
          }
        });

        // Re-apply filters to update displayed products with new ratings
        this.applyFilters();
      },
      error: (error) => {
        console.error('Error loading reviews for products:', error);
        // Set default values on error
        productsToLoad.forEach((product) => {
          if (!product.Rating) product.Rating = 0;
          if (!product.ReviewCount) product.ReviewCount = 0;
        });
      },
    });
  }

  // Kiểm tra sản phẩm có đánh giá hay không
  // Phải có cả Rating > 0 VÀ ReviewCount > 0 để đảm bảo có reviews thực sự
  // (Rating có thể > 0 từ database nhưng chưa được đồng bộ với reviews thực tế)
  hasReviews(product: Product): boolean {
    const rating = product.Rating ?? 0;
    const reviewCount = product.ReviewCount ?? 0;
    // Chỉ hiển thị rating khi có cả rating > 0 VÀ có reviews thực sự (reviewCount > 0)
    return rating > 0 && reviewCount > 0;
  }

  // Get first image from product images array
  getProductImage(product: Product): string {
    // Lấy ảnh đầu tiên từ array, hoặc empty string nếu không có
    return product.Image && product.Image.length > 0 ? product.Image[0] : '';
  }

  // -----------------------------
  // 🎯 Promotion Box Carousel
  // -----------------------------
  getVisibleBoxes(): Product[] {
    const visibleBoxes = [];
    for (let i = 0; i < 3; i++) {
      const boxIndex = this.currentBoxIndex + i;
      if (boxIndex < this.promotionProducts.length) {
        visibleBoxes.push(this.promotionProducts[boxIndex]);
      }
    }
    return visibleBoxes;
  }

  getBoxDots(): number[] {
    const dots = [];
    for (let i = 0; i < this.promotionProducts.length - 2; i++) {
      dots.push(i);
    }
    return dots;
  }

  prevPromotionBox(): void {
    if (this.currentBoxIndex > 0) {
      this.currentBoxIndex--;
    }
  }

  nextPromotionBox(): void {
    if (this.currentBoxIndex < this.promotionProducts.length - 3) {
      this.currentBoxIndex++;
    }
  }

  goToBox(index: number): void {
    this.currentBoxIndex = index;
  }

  // -----------------------------
  // 🎯 Navigation Arrows
  // -----------------------------
  scrollFilters(direction: 'left' | 'right'): void {
    if (!this.filtersContainer) {
      return;
    }

    const container = this.filtersContainer.nativeElement;
    const scrollAmount = 200; // Scroll 200px mỗi lần click

    if (direction === 'left') {
      container.scrollBy({
        left: -scrollAmount,
        behavior: 'smooth',
      });
    } else {
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth',
      });
    }
  }

  // -----------------------------
  // 🎯 Promotion Products
  // -----------------------------
  loadPromotionProducts(): void {
    this.promotionProducts = this.products
      .filter((p) => p.hasPromotion)
      .sort((a, b) => {
        return (b.discountPercent || 0) - (a.discountPercent || 0);
      })
      .slice(0, 6);
    console.log('Promotion products loaded:', this.promotionProducts.length);
  }

  // -----------------------------
  // 🎯 Promotion Box Properties
  // -----------------------------
  promotionProducts: Product[] = [];
  currentPromotionIndex: number = 0;
  promotionVisible: boolean = true;

  // -----------------------------
  // 🎯 Sort Options
  // -----------------------------
  sortOptions = [
    { value: 'newest', label: 'Mới nhất' },
    { value: 'bestseller', label: 'Bán chạy' },
    { value: 'price-low', label: 'Giá thấp → cao' },
    { value: 'price-high', label: 'Giá cao → thấp' },
  ];
  currentSort: string = 'newest';

  // -----------------------------
  // 🎯 Rating Count
  // -----------------------------
  getRatingCount(rating: number): number {
    // Đếm từ products đã lọc theo category, subcategory, price, promotion, color
    // NHƯNG KHÔNG tính rating filter và search query để hiển thị đúng số lượng cho mỗi mức sao
    // Sidebar luôn hiển thị tất cả categories, không bị ảnh hưởng bởi search query
    const baseProducts = this.products.filter((p) => {
      // Category filter (chỉ áp dụng khi không có search query hoặc có category được chọn)
      if (this.selectedCategories.length > 0 && !this.selectedCategories.includes(p.Category)) {
        return false;
      }

      // Subcategory filter (chỉ áp dụng khi không có search query hoặc có subcategory được chọn)
      if (
        this.selectedSubcategories.length > 0 &&
        !this.selectedSubcategories.includes(p.Subcategory)
      ) {
        return false;
      }

      // KHÔNG filter theo search query ở đây - sidebar luôn hiển thị tất cả categories

      // Promotion filter - kiểm tra promotionType (hỗ trợ cả string và array)
      if (this.selectedPromotions.length > 0) {
        const hasDiscountFilter = this.selectedPromotions.includes('Giảm giá');
        const hasBuy1Get1Filter = this.selectedPromotions.includes('Mua 1 tặng 1');

        // Kiểm tra promotionType là array hay string
        const hasNormalPromo = Array.isArray(p.promotionType)
          ? p.promotionType.includes('normal')
          : p.promotionType === 'normal';
        const hasBuy1Get1Promo = Array.isArray(p.promotionType)
          ? p.promotionType.includes('buy1get1')
          : p.promotionType === 'buy1get1';

        // Nếu chọn "Giảm giá" - hiển thị sản phẩm có promotionType là 'normal'
        // Nếu chọn "Mua 1 tặng 1" - hiển thị sản phẩm có promotionType là 'buy1get1'
        if (hasDiscountFilter && hasBuy1Get1Filter) {
          // Chọn cả 2: hiển thị tất cả sản phẩm có promotion
          if (!p.hasPromotion) {
            return false;
          }
        } else if (hasDiscountFilter) {
          // Chỉ chọn "Giảm giá"
          if (!p.hasPromotion || !hasNormalPromo) {
            return false;
          }
        } else if (hasBuy1Get1Filter) {
          // Chỉ chọn "Mua 1 tặng 1"
          if (!p.hasPromotion || !hasBuy1Get1Promo) {
            return false;
          }
        } else {
          // Không khớp với bất kỳ filter nào
          return false;
        }
      }

      // Color filter - hỗ trợ sản phẩm có nhiều màu
      if (!this.productMatchesColorFilter(p)) {
        return false;
      }

      // Price filter
      if (p.Price < this.minPrice || p.Price > this.maxPrice) {
        return false;
      }

      return true;
    });

    if (rating === 5) {
      // Đếm sản phẩm có đúng 5 sao
      return baseProducts.filter((p) => p.Rating === 5).length;
    } else {
      // Đếm sản phẩm có rating >= rating đã chọn
      return baseProducts.filter((p) => (p.Rating || 0) >= rating).length;
    }
  }

  // -----------------------------
  // 🎯 Helper Methods for Favorites & Scroll
  // -----------------------------
  loadFavoriteProducts(): void {
    if (this.authService.isLoggedIn()) {
      // Subscribe to wishlist changes to update UI in real-time
      const sub = this.wishlistService.wishlist$.subscribe((wishlist) => {
        this.favoriteProducts = wishlist.map((item) => item.sku);
      });
      this.subscriptions.push(sub);
    }
  }


}
