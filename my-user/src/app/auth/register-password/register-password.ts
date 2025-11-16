import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-register-password',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './register-password.html',
  styleUrls: ['./register-password.css'],
})
export class RegisterPassword implements OnInit {
  @Input() phoneNumber: string = '';
  @Input() isPopupMode: boolean = false;
  @Output() navigateToLogin = new EventEmitter<void>();
  @Output() registerSuccess = new EventEmitter<void>();

  password: string = '';
  confirmPassword: string = '';

  passwordError: string = '';
  confirmError: string = '';

  showPassword: boolean = false;
  showConfirm: boolean = false;

  showSuccessMessage: boolean = false;
  isNavigating: boolean = false; // Flag để tránh redirect khi đang navigation
  registrationSuccessful: boolean = false; // Flag để ngăn ngOnInit chạy lại

  constructor(private router: Router, private http: HttpClient) {}

  ngOnInit(): void {
 console.log(' [REGISTER-PASSWORD] ngOnInit called');
 console.log(' [REGISTER-PASSWORD] registrationSuccessful flag:', this.registrationSuccessful);

 // QUAN TRỌNG: Nếu đăng ký đã thành công, KHÔNG làm gì cả
    if (this.registrationSuccessful) {
 console.log(
        ' [REGISTER-PASSWORD] Đăng ký thành công, đang chờ chuyển trang, bỏ qua ngOnInit'
      );
      return;
    }

 // Get phone number from session storage
    this.phoneNumber = sessionStorage.getItem('registerPhone') || '';
    const otpVerified = sessionStorage.getItem('registerOtpVerified');
    const isRegistrationCompleted = sessionStorage.getItem('registrationCompleted');

 console.log(' [REGISTER-PASSWORD] Phone:', this.phoneNumber);
 console.log(' [REGISTER-PASSWORD] OTP Verified:', otpVerified);
 console.log(' [REGISTER-PASSWORD] Registration Completed:', isRegistrationCompleted);
 console.log(' [REGISTER-PASSWORD] isPopupMode:', this.isPopupMode);

 // Nếu đã hoàn thành đăng ký, redirect về login
    if (isRegistrationCompleted === 'true') {
 console.log(' [REGISTER-PASSWORD] Đăng ký đã hoàn thành, redirecting to login');
 // Clear flag để tránh redirect loop
      sessionStorage.removeItem('registrationCompleted');
      this.router.navigate(['/login']);
      return;
    }

 // Kiểm tra điều kiện truy cập trang (chỉ cho standalone mode)
    if (!this.isPopupMode && (!this.phoneNumber || !otpVerified)) {
 console.log(
        ' [REGISTER-PASSWORD] Missing phone or OTP verification, redirecting to register'
      );
      this.router.navigate(['/register']);
      return;
    }

 console.log(' [REGISTER-PASSWORD] ngOnInit completed, ready for password input');
  }

  onPasswordInput(event: any): void {
    this.password = event.target.value;
    this.validatePassword();
    this.validateConfirm();
  }

  onConfirmInput(event: any): void {
    this.confirmPassword = event.target.value;
    this.validateConfirm();
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirm(): void {
    this.showConfirm = !this.showConfirm;
  }

  validatePassword(): void {
    if (!this.password) {
      this.passwordError = '';
      return;
    }
    if (this.password.length < 8) {
      this.passwordError = 'Mật khẩu phải có ít nhất 8 ký tự.';
      return;
    }
    if (!/(?=.*[A-Z])/.test(this.password)) {
      this.passwordError = 'Mật khẩu phải có ít nhất 1 chữ cái in hoa.';
      return;
    }
    this.passwordError = '';
  }

  validateConfirm(): void {
    if (!this.confirmPassword) {
      this.confirmError = '';
      return;
    }
    this.confirmError =
      this.confirmPassword === this.password ? '' : 'Mật khẩu nhập lại không khớp.';
  }

  isFormValid(): boolean {
    return (
      this.password.length >= 8 &&
      this.confirmPassword === this.password &&
      !this.passwordError &&
      !this.confirmError
    );
  }

  onSubmit(): void {
    if (!this.isFormValid()) return;

    const registerData = {
      phoneNumber: this.phoneNumber,
      password: this.password,
    };

 console.log(' [REGISTER-PASSWORD] Gửi request đăng ký...');

    this.http.post('/api/auth/register', registerData).subscribe({
      next: (response: any) => {
 console.log(' [REGISTER-PASSWORD] Đăng ký thành công!', response);

 // QUAN TRỌNG: Set flag ngay lập tức để ngăn ngOnInit chạy lại
        this.registrationSuccessful = true;
 console.log('� [REGISTER-PASSWORD] Set registrationSuccessful = true');

        this.showSuccessMessage = true;

 // Lưu thông tin user và token vào localStorage (tự động đăng nhập sau khi đăng ký)
 // Hỗ trợ cả 2 cấu trúc response: response.data hoặc response trực tiếp
        if (response.data) {
 // Cấu trúc 1: {data: {token, user}}
          localStorage.setItem('token', response.data.token);
          localStorage.setItem('user', JSON.stringify(response.data.user));
 console.log(
            ' [REGISTER-PASSWORD] Đã lưu token và user vào localStorage (từ response.data)'
          );
        } else if (response.user) {
 // Cấu trúc 2: {message, user, token}
          const token = response.token || 'temp-token-' + Date.now();
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(response.user));
 console.log(
            ' [REGISTER-PASSWORD] Đã lưu token và user vào localStorage (từ response trực tiếp)'
          );
        }

 // Clear session storage
        sessionStorage.removeItem('registerPhone');
        sessionStorage.removeItem('registerOtpVerified');
        sessionStorage.removeItem('registerOtp');
        sessionStorage.removeItem('registrationCompleted');

 // QUAN TRỌNG: Clear popup state để tránh restore lại sau reload
        sessionStorage.removeItem('activePopup');
        sessionStorage.removeItem('popupData');
 console.log(' [REGISTER-PASSWORD] Đã clear popup state từ sessionStorage');

 console.log(
          '⏳ [REGISTER-PASSWORD] Hiển thị success message, sẽ chuyển trang sau 2 giây...'
        );
 console.log(' [REGISTER-PASSWORD] isPopupMode:', this.isPopupMode);

 // Hiển thị success message trong 2 giây, sau đó reload page để cập nhật header
        setTimeout(() => {
 console.log(' [REGISTER-PASSWORD] 2 giây đã qua!');
          if (this.isPopupMode) {
 console.log(' [REGISTER-PASSWORD] POPUP MODE - Emit registerSuccess');

 // Clear popup state trước khi emit (đóng popup)
            sessionStorage.removeItem('activePopup');
            sessionStorage.removeItem('popupData');
 console.log(' [REGISTER-PASSWORD] Clear popup state (popup mode)');

 // Popup mode: emit success và reload page
            this.registerSuccess.emit();
          } else {
 console.log(' [REGISTER-PASSWORD] STANDALONE MODE - Reload về trang chủ');
 console.log(' [REGISTER-PASSWORD] Thử cách 1: window.location.href');

            try {
              window.location.href = '/';
 console.log(' [REGISTER-PASSWORD] Đã gọi window.location.href');
            } catch (error) {
 console.error(' [REGISTER-PASSWORD] Lỗi với window.location.href:', error);
 console.log(' [REGISTER-PASSWORD] Thử cách 2: window.location.replace');

              try {
                window.location.replace('/');
 console.log(' [REGISTER-PASSWORD] Đã gọi window.location.replace');
              } catch (error2) {
 console.error(' [REGISTER-PASSWORD] Lỗi với window.location.replace:', error2);
 console.log(' [REGISTER-PASSWORD] Thử cách 3: router.navigate + reload');

                this.router.navigate(['/']).then(() => {
 console.log(' [REGISTER-PASSWORD] Router navigate thành công, reload...');
                  window.location.reload();
                });
              }
            }
          }
        }, 2000);
      },
      error: (error) => {
 console.error(' [REGISTER-PASSWORD] Lỗi đăng ký:', error);
      },
    });
  }

 // Popup navigation methods
  onLoginClick(event: Event) {
    event.preventDefault();
    this.navigateToLogin.emit();
  }
}
