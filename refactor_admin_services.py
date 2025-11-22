import os
import re

# Define the base directory
base_dir = r'd:\Vgreen\my-admin\src\app'

# Files to update with their hardcoded URLs
files_to_update = {
    r'services\auth.service.ts': [
        ("private baseUrl = 'http://localhost:3000/api';", "private baseUrl = environment.apiUrl;", 18),
    ],
    r'services\api.service.ts': [
        ("private baseUrl = 'http://localhost:3000/api'; // Thay đổi URL này theo backend của bạn", "private baseUrl = environment.apiUrl;", 13),
    ],
    r'services\notification.service.ts': [
        ("private apiUrl = 'http://localhost:3000/api/notifications';", "private apiUrl = `${environment.apiUrl}/notifications`;", 31),
    ],
}

# Add environment import to files
imports_to_add = {
    r'services\auth.service.ts': ("import { map, catchError, timeout } from 'rxjs/operators';", "import { map, catchError, timeout } from 'rxjs/operators';\nimport { environment } from '../../environments/environment';"),
    r'services\api.service.ts': ("import { HttpClient, HttpHeaders } from '@angular/common/http';", "import { HttpClient, HttpHeaders } from '@angular/common/http';\nimport { environment } from '../../environments/environment';"),
    r'services\notification.service.ts': ("import { BehaviorSubject, Observable, interval } from 'rxjs';", "import { BehaviorSubject, Observable, interval } from 'rxjs';\nimport { environment } from '../../environments/environment';"),
}

# Process each file
for file_path, replacements in files_to_update.items():
    full_path = os.path.join(base_dir, file_path)
    
    if os.path.exists(full_path):
        with open(full_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Add import if needed
        if file_path in imports_to_add:
            old_import, new_import = imports_to_add[file_path]
            content = content.replace(old_import, new_import)
        
        # Replace hardcoded URLs
        for old_url, new_url, line_num in replacements:
            content = content.replace(old_url, new_url)
        
        # Write back
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        print(f"✅ Updated: {file_path}")
    else:
        print(f"❌ Not found: {full_path}")

print("\n✅ All service files updated!")
