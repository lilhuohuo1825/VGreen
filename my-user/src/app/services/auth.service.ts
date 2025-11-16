import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { MockBackendService } from './mock-backend.service';

export interface User {
  id: string;
  phoneNumber: string;
  fullName: string;
  email?: string;
  createdAt: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data?: {
    user: User;
    token: string;
  };
}

export interface RegisterRequest {
  phoneNumber: string;
  password: string;
  fullName: string;
  email?: string;
}

export interface LoginRequest {
  phoneNumber: string;
  password: string;
}

export interface ForgotPasswordRequest {
  phoneNumber: string;
}

export interface ResetPasswordRequest {
  phoneNumber: string;
  newPassword: string;
  otp: string;
}

export interface UpdateUserInfoRequest {
  customerID?: string;
  phoneNumber?: string;
  fullName?: string;
  email?: string;
  address?: string;
  birthDay?: string;
  gender?: 'male' | 'female' | 'other';
}

export interface UpdateUserInfoResponse {
  success: boolean;
  message: string;
  data?: {
    CustomerID: string;
    Phone: string;
    FullName: string | null;
    Email: string | null;
    Address: string | null;
    BirthDay: string | null;
    Gender: string | null;
  };
  error?: string;
}

export interface ChangePasswordRequest {
  customerID: string;
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  success: boolean;
  message: string;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly API_URL = 'http://localhost:3000/api/auth';
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private mockBackend: MockBackendService, private http: HttpClient) {
    // Load user from localStorage on service initialization
    this.loadUserFromStorage();
  }

  // Register new user
  register(userData: RegisterRequest): Observable<AuthResponse> {
    return this.mockBackend.register(userData).pipe(
      tap((response) => {
        if (response.success && response.data) {
          this.setCurrentUser(response.data.user, response.data.token);
        }
      })
    );
  }

  // Login user
  login(credentials: LoginRequest): Observable<AuthResponse> {
    return this.mockBackend.login(credentials).pipe(
      tap((response) => {
        if (response.success && response.data) {
          this.setCurrentUser(response.data.user, response.data.token);
        }
      })
    );
  }

  // Forgot password
  forgotPassword(phoneNumber: string): Observable<any> {
    return this.mockBackend.forgotPassword(phoneNumber);
  }

  // Reset password
  resetPassword(resetData: ResetPasswordRequest): Observable<any> {
    return this.mockBackend.resetPassword(resetData);
  }

  // Send OTP for registration
  sendOtp(phoneNumber: string): Observable<any> {
    return this.mockBackend.sendOtp(phoneNumber);
  }

  // Send OTP for forgot password
  sendForgotPasswordOtp(phoneNumber: string): Observable<any> {
    return this.mockBackend.sendForgotPasswordOtp(phoneNumber);
  }

  // Verify OTP for registration
  verifyOtp(phoneNumber: string, otp: string): Observable<any> {
    return this.mockBackend.verifyOtp(phoneNumber, otp);
  }

  // Verify OTP for forgot password
  verifyForgotPasswordOtp(phoneNumber: string, otp: string): Observable<any> {
    return this.mockBackend.verifyForgotPasswordOtp(phoneNumber, otp);
  }

  // Logout user
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUserSubject.next(null);
  }

  // Get current user
  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  // Check if user is logged in
  isLoggedIn(): boolean {
    const token = localStorage.getItem('token');
    return !!token;
  }

  // Get auth token
  getToken(): string | null {
    return localStorage.getItem('token');
  }

  // Set current user and save to storage
  private setCurrentUser(user: User, token: string): void {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  // Load user from localStorage
  private loadUserFromStorage(): void {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        this.currentUserSubject.next(user);
      } catch (error) {
        console.error('Error parsing user from localStorage:', error);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
      }
    }
  }

  // Update user information
  updateUserInfo(updateData: UpdateUserInfoRequest): Observable<UpdateUserInfoResponse> {
    console.log(' [AuthService] Updating user info:', updateData);

    return this.http
      .put<UpdateUserInfoResponse>('http://localhost:3000/api/auth/user/update', updateData)
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            console.log(' [AuthService] User info updated successfully');
            // Update localStorage with new user data
            const currentUser = localStorage.getItem('user');
            if (currentUser) {
              try {
                const user = JSON.parse(currentUser);
                // Update user object with new data (support both PascalCase and camelCase)
                // Always update FullName, even if null/empty (to handle deletion)
                if (response.data.FullName !== undefined) {
                  user.FullName = response.data.FullName;
                  user.fullName = response.data.FullName;
                } else if ('FullName' in response.data) {
                  // Backend explicitly returned FullName (could be null)
                  user.FullName = response.data.FullName;
                  user.fullName = response.data.FullName;
                }
                if (response.data.Email !== undefined) {
                  user.Email = response.data.Email;
                  user.email = response.data.Email;
                }
                if (response.data.BirthDay !== undefined) user.BirthDay = response.data.BirthDay;
                if (response.data.Gender !== undefined) user.Gender = response.data.Gender;
                if (response.data.Address !== undefined) {
                  user.Address = response.data.Address;
                  user.address = response.data.Address;
                }

                localStorage.setItem('user', JSON.stringify(user));
                console.log(' [AuthService] Updated user in localStorage:', user);
              } catch (error) {
                console.error(' [AuthService] Error updating user in localStorage:', error);
              }
            }
          }
        }),
        catchError((error) => {
          console.error(' [AuthService] Error updating user info:', error);
          throw error;
        })
      );
  }

  // Change password
  changePassword(data: ChangePasswordRequest): Observable<ChangePasswordResponse> {
    console.log(' [AuthService] Changing password for customer:', data.customerID);

    return this.http
      .post<ChangePasswordResponse>('http://localhost:3000/api/auth/change-password', data)
      .pipe(
        tap((response) => {
          if (response.success) {
            console.log(' [AuthService] Password changed successfully');
          }
        }),
        catchError((error) => {
          console.error(' [AuthService] Error changing password:', error);
          throw error;
        })
      );
  }

  // Public method để reload user từ localStorage (dùng khi login/register không qua AuthService)
  reloadUserFromStorage(): void {
    console.log(' [AuthService] Reloading user from localStorage...');
    this.loadUserFromStorage();
  }
}
