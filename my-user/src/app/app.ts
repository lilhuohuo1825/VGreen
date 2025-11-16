import { Component, signal, effect } from '@angular/core';
import {
  Router,
  RouterOutlet,
  RouterModule,
  NavigationStart,
  NavigationEnd,
} from '@angular/router';
import { CommonModule } from '@angular/common';
import { CartService } from './services/cart.service';
import { CartComponent } from './cart/cart';
import { ScrollLockService } from './services/scroll-lock.service';
import { FooterComponent } from './footer/footer';
import { HeaderComponent } from './header/header';
import { AuthPopupComponent } from './auth/auth-popup/auth-popup';
import { AuthPopupService } from './services/auth-popup.service';
import { Veebot } from './veebot/veebot';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    CartComponent,
    CommonModule,
    HeaderComponent,
    FooterComponent,
    RouterModule,
    AuthPopupComponent,
    Veebot,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('my-user');

  // Debug computed property
  get isCartOpen() {
    return this.cartService.getIsOpen()();
  }

  constructor(
    public cartService: CartService,
    private scrollLock: ScrollLockService,
    public authPopupService: AuthPopupService,
    private router: Router
  ) {
    console.log(' [APP] Constructor được gọi - App component đang khởi tạo');
    console.log(' [APP] Current URL:', window.location.href);

    // Track window.location changes
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      console.log('🌐 [HISTORY] pushState called:', args[2]);
      return originalPushState.apply(history, args);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      console.log('🌐 [HISTORY] replaceState called:', args[2]);
      return originalReplaceState.apply(history, args);
    };

    // Track router events
    this.router.events
      .pipe(filter((event) => event instanceof NavigationStart || event instanceof NavigationEnd))
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          console.log('🧭 [ROUTER] Navigation START:', event.url);
        } else if (event instanceof NavigationEnd) {
          console.log('🧭 [ROUTER] Navigation END:', event.url);
        }
      });

    // Track page reload/unload
    window.addEventListener('beforeunload', (e) => {
      console.log(' [WINDOW] beforeunload - Page đang reload/navigate away!');
      console.log(' Stack trace:', new Error().stack);
    });

    // Quản lý scroll lock
    effect(() => {
      const isOpen = this.cartService.getIsOpen()();

      if (isOpen) {
        this.scrollLock.lock();
      } else {
        this.scrollLock.unlock();
      }
    });
  }

  onCheckout() {
    // Logic checkout sẽ được implement sau
    console.log('Checkout clicked');
  }

  onSelectAll() {
    this.cartService.toggleSelectAll();
  }
}
