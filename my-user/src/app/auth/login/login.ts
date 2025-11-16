import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ToastService } from '../../services/toast.service';
import { AuthPopupService } from '../../services/auth-popup.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule, RouterLink],
  templateUrl: './login.html',
  styleUrls: ['./login.css'],
})
export class Login implements OnInit {
  @Input() isPopupMode: boolean = false;
  @Output() navigateToRegister = new EventEmitter<void>();
  @Output() navigateToForgotPassword = new EventEmitter<void>();
  @Output() loginSuccess = new EventEmitter<void>();

  @ViewChild('phoneInput') phoneInputRef!: ElementRef<HTMLInputElement>;

  phoneNumber: string = '';
  password: string = '';
  showPassword: boolean = false;
  phoneError: string = '';
  passwordError: string = '';
  loginError: string = '';
  isLoading: boolean = false;

  constructor(
    private router: Router,
    private http: HttpClient,
    private toastService: ToastService,
    private authPopupService: AuthPopupService
  ) {}

  ngOnInit(): void {
    console.log(' [LOGIN] ngOnInit - Login component khởi tạo');
    console.log(' [LOGIN] isPopupMode:', this.isPopupMode);

    // Chỉ clear registration/forgot-password keys (KHÔNG clear activePopup!)
    console.log(' [LOGIN] Clear specific sessionStorage keys');
    sessionStorage.removeItem('registerPhone');
    sessionStorage.removeItem('registerOtpVerified');
    sessionStorage.removeItem('registerOtp');
    sessionStorage.removeItem('registrationCompleted');
    sessionStorage.removeItem('forgotPasswordPhone');
    sessionStorage.removeItem('forgotPasswordOtpVerified');
    sessionStorage.removeItem('passwordResetCompleted');

    // Auto-focus vào input số điện thoại khi vào trang
    setTimeout(() => {
      const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
      if (phoneInput) {
        phoneInput.focus();
      }
    }, 100);

    console.log(' [LOGIN] ngOnInit HOÀN TẤT');
  }

  // Handle phone input
  onPhoneInput(event: any): void {
    this.phoneNumber = event.target.value;
    this.validatePhone();
  }

  // Handle password input
  onPasswordInput(event: any): void {
    this.password = event.target.value;
    this.validatePassword();
  }

  // Phone number validation
  validatePhone(): void {
    const phoneRegex = /^[0-9]{10,11}$/;
    if (this.phoneNumber && !phoneRegex.test(this.phoneNumber)) {
      this.phoneError = 'Số điện thoại không hợp lệ.';
    } else {
      this.phoneError = '';
    }
  }

  // Password validation
  validatePassword(): void {
    if (this.password && this.password.length < 8) {
      this.passwordError = 'Mật khẩu phải có ít nhất 8 ký tự.';
    } else if (this.password && !/(?=.*[A-Z])/.test(this.password)) {
      this.passwordError = 'Mật khẩu phải có ít nhất 1 chữ cái in hoa.';
    } else {
      this.passwordError = '';
    }
  }

  // Clear phone number input
  clearPhone(): void {
    this.phoneNumber = '';
    this.phoneError = '';

    // Focus vào ô input sau khi clear
    setTimeout(() => {
      if (this.phoneInputRef?.nativeElement) {
        this.phoneInputRef.nativeElement.focus();
      }
    }, 0);
  }

  // Toggle password visibility
  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  // Check if form is valid
  isFormValid(): boolean {
    return (
      this.phoneNumber.length >= 10 &&
      this.password.length >= 8 &&
      !this.phoneError &&
      !this.passwordError
    );
  }

  // Handle form submission
  onSubmit(): void {
    if (!this.isFormValid()) return;

    // Clear previous errors
    this.phoneError = '';
    this.passwordError = '';
    this.loginError = '';
    this.isLoading = true;

    console.log('Đang kiểm tra đăng nhập...', {
      phone: this.phoneNumber,
      password: this.password,
    });

    // Bước 1: Kiểm tra số điện thoại có tồn tại không
    this.http.post('/api/auth/check-phone-exists', { phoneNumber: this.phoneNumber }).subscribe({
      next: (response: any) => {
        console.log('Số điện thoại tồn tại:', response);

        // Bước 2: Nếu số điện thoại tồn tại, kiểm tra mật khẩu
        this.verifyPassword();
      },
      error: (error) => {
        console.error('Lỗi kiểm tra số điện thoại:', error);
        this.isLoading = false;

        // Xử lý các loại lỗi khác nhau
        if (error.status === 0) {
          // Network error - không kết nối được đến backend
          this.loginError =
            'Không thể kết nối đến server. Vui lòng kiểm tra backend đang chạy tại http://localhost:3000';
        } else if (error.status === 503) {
          // Service Unavailable - MongoDB chưa kết nối
          this.loginError = 'Server chưa sẵn sàng. Vui lòng thử lại sau.';
        } else if (error.status === 400) {
          this.phoneError = 'Số điện thoại chưa được đăng ký';
        } else if (error.status === 404) {
          this.phoneError = 'Số điện thoại chưa được đăng ký';
        } else {
          this.loginError = 'Lỗi kết nối, vui lòng thử lại';
        }
      },
    });
  }

  // Bước 2: Xác minh mật khẩu
  private verifyPassword(): void {
    const loginData = {
      phoneNumber: this.phoneNumber,
      password: this.password,
    };

    console.log('Đang xác minh mật khẩu...', loginData);

    this.http.post('/api/auth/login', loginData).subscribe({
      next: (response: any) => {
        console.log('Đăng nhập thành công!', response);
        this.isLoading = false;

        // Hiển thị thông báo đăng nhập thành công
        this.toastService.show('Đăng nhập thành công!', 'success');

        // Lưu thông tin user và token vào localStorage
        // Hỗ trợ cả 2 cấu trúc response: response.data hoặc response trực tiếp
        if (response.data) {
          // Cấu trúc 1: {data: {token, user}}
          localStorage.setItem('token', response.data.token);
          localStorage.setItem('user', JSON.stringify(response.data.user));
          // console.log(' Đã lưu token và user vào localStorage (từ response.data)');
        } else if (response.user) {
          // Cấu trúc 2: {message, user, token}
          const token = response.token || 'temp-token-' + Date.now(); // Tạo token tạm nếu không có
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(response.user));
          // console.log(' Đã lưu token và user vào localStorage (từ response trực tiếp)');
        }

        // Navigate to main page (chưa implement)
        console.log('>>> Chuyển đến trang chính...');

        // Emit success event for popup mode
        if (this.isPopupMode) {
          this.loginSuccess.emit();
        } else {
          // this.router.navigate(['/dashboard']); // TODO: Implement dashboard
        }
      },
      error: (error) => {
        console.error('Lỗi đăng nhập:', error);
        this.isLoading = false;

        // Xử lý các loại lỗi khác nhau
        if (error.status === 0) {
          // Network error - không kết nối được đến backend
          this.loginError =
            'Không thể kết nối đến server. Vui lòng kiểm tra backend đang chạy tại http://localhost:3000';
        } else if (error.status === 503) {
          // Service Unavailable - MongoDB chưa kết nối
          this.loginError = 'Server chưa sẵn sàng. Vui lòng thử lại sau.';
        } else if (error.error && error.error.message) {
          const errorMessage = error.error.message.toLowerCase();

          if (errorMessage.includes('mật khẩu') || errorMessage.includes('password')) {
            this.passwordError = 'Mật khẩu không chính xác';
          } else if (errorMessage.includes('số điện thoại') || errorMessage.includes('phone')) {
            this.phoneError = 'Số điện thoại không tồn tại';
          } else {
            this.loginError = error.error.message || error.error.error || 'Có lỗi xảy ra';
          }
        } else if (error.status === 401) {
          // 401 Unauthorized = Mật khẩu sai (vì số điện thoại đã được xác nhận ở bước 1)
          console.log('401 Unauthorized - Mật khẩu sai');
          this.passwordError = 'Mật khẩu không chính xác';
        } else if (error.status === 400) {
          this.passwordError = 'Mật khẩu không chính xác';
        } else if (error.status === 404) {
          this.phoneError = 'Số điện thoại không tồn tại';
        } else {
          this.loginError = 'Lỗi kết nối, vui lòng thử lại';
        }
      },
    });
  }

  // Popup navigation methods
  onRegisterClick(event: Event) {
    event.preventDefault();
    this.navigateToRegister.emit();
  }

  onForgotPasswordClick(event: Event) {
    event.preventDefault();
    this.navigateToForgotPassword.emit();
  }

  // Social login methods
  onGoogleLogin(): void {
    console.log('� [LOGIN] Google login clicked');
    // TODO: Implement Google OAuth login
    this.toastService.show('Tính năng đăng nhập bằng Google đang được phát triển');
  }

  onFacebookLogin(): void {
    console.log('� [LOGIN] Facebook login clicked');
    // TODO: Implement Facebook OAuth login
    this.toastService.show('Tính năng đăng nhập bằng Facebook đang được phát triển');
  }

  // Close popup when in popup mode
  onClosePopup(): void {
    if (this.isPopupMode) {
      this.authPopupService.closePopup();
    }
  }
}
