import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, catchError, timeout } from 'rxjs/operators';

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private baseUrl = 'http://localhost:3000/api';
  
  // Signal để track trạng thái đăng nhập
  isAuthenticated = signal<boolean>(false);
  currentUser = signal<AdminUser | null>(null);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // Kiểm tra xem có session không khi khởi động
    this.checkSession();
  }

  /**
   * Kiểm tra session hiện tại
   */
  private checkSession(): void {
    const authToken = localStorage.getItem('admin_token');
    const userStr = localStorage.getItem('admin_user');
    
    if (authToken && userStr) {
      try {
        const user = JSON.parse(userStr);
        this.isAuthenticated.set(true);
        this.currentUser.set(user);
      } catch (e) {
        this.clearSession();
      }
    }
  }

  /**
   * Đăng nhập
   * Gọi API backend để xác thực admin từ MongoDB collection 'admins' hoặc 'users'
   */
  login(email: string, password: string): Observable<boolean> {
    console.log('🔹 AuthService.login() called');
    console.log(`   Email: ${email}`);
    console.log(`   API endpoint: ${this.baseUrl}/auth/login`);
    
    // Gọi API đăng nhập với timeout 10 giây
    return this.http.post<any>(`${this.baseUrl}/auth/login`, { 
      email, 
      password 
    }).pipe(
      timeout(10000), // 10 seconds timeout
      map(response => {
        console.log('✅ Backend response received:', response);
        
        if (response && response.token) {
          console.log('✅ Valid token received');
          console.log('👤 User data:', response.user);
          
          // Lưu token và thông tin user vào localStorage
          localStorage.setItem('admin_token', response.token);
          localStorage.setItem('admin_user', JSON.stringify(response.user));
          
          // Cập nhật signals
          this.isAuthenticated.set(true);
          this.currentUser.set(response.user);
          
          console.log('✅ AuthService: Login state updated');
          console.log(`   - isAuthenticated: ${this.isAuthenticated()}`);
          console.log(`   - currentUser:`, this.currentUser());
          
          return true;
        }
        
        console.log('❌ Invalid response from backend');
        return false;
      }),
      catchError((error: HttpErrorResponse | Error) => {
        console.error('❌ AuthService: Login API error:', error);
        
        // Xử lý timeout error
        if (error instanceof Error && error.name === 'TimeoutError') {
          const timeoutError = new HttpErrorResponse({
            error: { message: 'Request timeout. Vui lòng kiểm tra kết nối mạng và thử lại.' },
            status: 408,
            statusText: 'Request Timeout'
          });
          throw timeoutError;
        }
        
        // Xử lý network error (status 0)
        if (error instanceof HttpErrorResponse && error.status === 0) {
          const networkError = new HttpErrorResponse({
            error: { message: 'Không kết nối được với server. Vui lòng kiểm tra backend đang chạy.' },
            status: 0,
            statusText: 'Network Error'
          });
          throw networkError;
        }
        
        console.error('   Status:', error instanceof HttpErrorResponse ? error.status : 'N/A');
        console.error('   Message:', error.message);
        
        // Throw error để component xử lý
        throw error;
      })
    );
  }

  /**
   * Đăng xuất
   */
  logout(): void {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  /**
   * Xóa session
   */
  private clearSession(): void {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    this.isAuthenticated.set(false);
    this.currentUser.set(null);
  }

  /**
   * Lấy token hiện tại
   */
  getToken(): string | null {
    return localStorage.getItem('admin_token');
  }

  /**
   * Kiểm tra email để reset password
   * Trả về full response bao gồm OTP (trong development mode)
   */
  requestPasswordReset(email: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/auth/forgot-password`, { email })
      .pipe(
        timeout(10000), // 10 seconds timeout
        map(response => {
          console.log('📧 Password reset response:', response);
          return response;
        }),
        catchError((error: HttpErrorResponse | Error) => {
          console.error('Password reset request error:', error);
          
          // Xử lý timeout
          if (error instanceof Error && error.name === 'TimeoutError') {
            throw new HttpErrorResponse({
              error: { message: 'Request timeout. Vui lòng thử lại.' },
              status: 408,
              statusText: 'Request Timeout'
            });
          }
          
          // Xử lý network error
          if (error instanceof HttpErrorResponse && error.status === 0) {
            throw new HttpErrorResponse({
              error: { message: 'Không kết nối được với server. Vui lòng kiểm tra backend đang chạy.' },
              status: 0,
              statusText: 'Network Error'
            });
          }
          
          throw error;
        })
      );
  }

  /**
   * Xác thực mã OTP
   */
  verifyOTP(email: string, otp: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/auth/verify-otp`, { 
      email, 
      otp 
    }).pipe(
      timeout(10000), // 10 seconds timeout
      map(response => {
        console.log('✅ OTP verification response:', response);
        return response;
      }),
      catchError((error: HttpErrorResponse | Error) => {
        console.error('❌ OTP verification error:', error);
        
        // Xử lý timeout và network error
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new HttpErrorResponse({
            error: { message: 'Request timeout. Vui lòng thử lại.' },
            status: 408,
            statusText: 'Request Timeout'
          });
        }
        
        if (error instanceof HttpErrorResponse && error.status === 0) {
          throw new HttpErrorResponse({
            error: { message: 'Không kết nối được với server. Vui lòng kiểm tra backend đang chạy.' },
            status: 0,
            statusText: 'Network Error'
          });
        }
        
        throw error;
      })
    );
  }

  /**
   * Reset password với OTP
   */
  resetPassword(email: string, otp: string, newPassword: string): Observable<boolean> {
    return this.http.post<any>(`${this.baseUrl}/auth/reset-password`, { 
      email, 
      otp, 
      newPassword 
    }).pipe(
      timeout(10000), // 10 seconds timeout
      map(response => true),
      catchError((error: HttpErrorResponse | Error) => {
        console.error('Password reset error:', error);
        
        // Xử lý timeout và network error
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new HttpErrorResponse({
            error: { message: 'Request timeout. Vui lòng thử lại.' },
            status: 408,
            statusText: 'Request Timeout'
          });
        }
        
        if (error instanceof HttpErrorResponse && error.status === 0) {
          throw new HttpErrorResponse({
            error: { message: 'Không kết nối được với server. Vui lòng kiểm tra backend đang chạy.' },
            status: 0,
            statusText: 'Network Error'
          });
        }
        
        throw error;
      })
    );
  }
}

