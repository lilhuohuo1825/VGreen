import os
import re

# Define the base directory
base_dir = r'd:\Vgreen\my-admin\src\app'

# Component files with hardcoded URLs and their replacements
component_updates = [
    # promotionmanage.ts - 23 instances
    (r'promotionmanage\promotionmanage.ts', [
        ("this.http.get<any>('http://localhost:3000/api/products/metadata/categories')", "this.http.get<any>(`${environment.apiUrl}/products/metadata/categories`)"),
        ("this.http.get<any>('http://localhost:3000/api/products/metadata/subcategories')", "this.http.get<any>(`${environment.apiUrl}/products/metadata/subcategories`)"),
        ("this.http.get<any>('http://localhost:3000/api/products/metadata/brands')", "this.http.get<any>(`${environment.apiUrl}/products/metadata/brands`)"),
        ("this.http.get<any>('http://localhost:3000/api/products/metadata/products')", "this.http.get<any>(`${environment.apiUrl}/products/metadata/products`)"),
        ("this.http.get<any>(`http://localhost:3000/api/promotion-targets/${promotionId}`)", "this.http.get<any>(`${environment.apiUrl}/promotion-targets/${promotionId}`)"),
        ("this.http.put(`http://localhost:3000/api/promotions/${update.id}`", "this.http.put(`${environment.apiUrl}/promotions/${update.id}`"),
        ("return this.http.delete(`http://localhost:3000/api/promotions/${promotionId}`)", "return this.http.delete(`${environment.apiUrl}/promotions/${promotionId}`)"),
        ("this.http.post('http://localhost:3000/api/promotion-targets'", "this.http.post(`${environment.apiUrl}/promotion-targets`"),
        ("this.http.post('http://localhost:3000/api/promotions'", "this.http.post(`${environment.apiUrl}/promotions`"),
        ("console.log('📤 [Update Promotion] Sending PUT request to:', `http://localhost:3000/api/promotions/${identifier}`);", "console.log('📤 [Update Promotion] Sending PUT request to:', `${environment.apiUrl}/promotions/${identifier}`);"),
        ("this.http.put(`http://localhost:3000/api/promotions/${identifier}`", "this.http.put(`${environment.apiUrl}/promotions/${identifier}`"),
        ("this.http.delete(`http://localhost:3000/api/promotion-targets/${promotionId}`)", "this.http.delete(`${environment.apiUrl}/promotion-targets/${promotionId}`)"),
        ("this.http.put<any>(`http://localhost:3000/api/promotions/${promotionId}`", "this.http.put<any>(`${environment.apiUrl}/promotions/${promotionId}`"),
        ("this.http.put<any>(`http://localhost:3000/api/promotion-targets/${promotionId}`", "this.http.put<any>(`${environment.apiUrl}/promotion-targets/${promotionId}`"),
        ("this.http.post<any>(`http://localhost:3000/api/promotion-targets`", "this.http.post<any>(`${environment.apiUrl}/promotion-targets`"),
    ]),
    # orderdetail.ts
    (r'orderdetail\orderdetail.ts', [
        ("this.http.get<any>('http://localhost:3000/api/tree_complete')", "this.http.get<any>(`${environment.apiUrl}/tree_complete`)"),
    ]),
    # layout.ts
    (r'layout\layout.ts', [
        ("this.http.get<any>(`http://localhost:3000/api/orders/${notification.orderId}`)", "this.http.get<any>(`${environment.apiUrl}/orders/${notification.orderId}`)"),
        ("this.http.get<any>('http://localhost:3000/api/orders')", "this.http.get<any>(`${environment.apiUrl}/orders`)"),
    ]),
    # customerdetail.ts
    (r'customerdetail\customerdetail.ts', [
        ("this.http.get<any>(`http://localhost:3000/api/users/customer/${customerID}`)", "this.http.get<any>(`${environment.apiUrl}/users/customer/${customerID}`)"),
        ("this.http.get<any>(`http://localhost:3000/api/orders/customer/${customerID}`)", "this.http.get<any>(`${environment.apiUrl}/orders/customer/${customerID}`)"),
        ("this.http.get<any>(`http://localhost:3000/api/address/${customerID}`)", "this.http.get<any>(`${environment.apiUrl}/address/${customerID}`)"),
        ("this.http.put(`http://localhost:3000/api/users/customer/${customerID}`", "this.http.put(`${environment.apiUrl}/users/customer/${customerID}`"),
    ]),
    # consultationmanage.ts
    (r'consultationmanage\consultationmanage.ts', [
        ("this.http.get<any>('http://localhost:3000/api/consultations')", "this.http.get<any>(`${environment.apiUrl}/consultations`)"),
    ]),
    # consultationdetail.ts
    (r'consultationdetail\consultationdetail.ts', [
        ("this.http.get<any>(`http://localhost:3000/api/consultations/${this.sku}`)", "this.http.get<any>(`${environment.apiUrl}/consultations/${this.sku}`)"),
        ("      `http://localhost:3000/api/consultations/${this.consultation.sku}/answer/${this.selectedQuestion._id}`,", "      `${environment.apiUrl}/consultations/${this.consultation.sku}/answer/${this.selectedQuestion._id}`,"),
        ("      `http://localhost:3000/api/consultations/${this.consultation.sku}/question/${question._id}`", "      `${environment.apiUrl}/consultations/${this.consultation.sku}/question/${question._id}`"),
    ]),
    # blogmanage.ts
    (r'blogmanage\blog.ts', [
        ("this.http.get<any>(`http://localhost:3000/api/blogs/${blogId}`)", "this.http.get<any>(`${environment.apiUrl}/blogs/${blogId}`)"),
    ]),
]

# Add environment imports
component_imports = {
    r'promotionmanage\promotionmanage.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'orderdetail\orderdetail.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'layout\layout.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'customerdetail\customerdetail.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'consultationmanage\consultationmanage.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'consultationdetail\consultationdetail.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'blogmanage\blog.ts': ("import { HttpClient } from '@angular/common/http';", "import { HttpClient } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
}

# Process each component
for file_path, replacements in component_updates:
    full_path = os.path.join(base_dir, file_path)
    
    if os.path.exists(full_path):
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Add import if needed
        if file_path in component_imports:
            old_import, new_import = component_imports[file_path]
            if old_import in content and 'environment' not in content:
                content = content.replace(old_import, new_import)
        
        # Replace all hardcoded URLs
        for old_url, new_url in replacements:
            content = content.replace(old_url, new_url)
        
        # Write back
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"✅ Updated: {file_path}")
    else:
        print(f"❌ Not found: {full_path}")

print("\n✅ All component files updated!")
