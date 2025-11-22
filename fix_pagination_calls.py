import re

files_to_fix = [
    r"d:\Vgreen\my-user\src\app\product\product-list\product-list.ts",
    r"d:\Vgreen\my-user\src\app\product\product-detail\product-detail.ts",
    r"d:\Vgreen\my-user\src\app\home\home.ts",
    r"d:\Vgreen\my-user\src\app\header\header.ts",
    r"d:\Vgreen\my-user\src\app\account\wishlist\wishlist.ts",
]

for file_path in files_to_fix:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Replace getAllProducts() with getAllProductsNoPagination()
        updated_content = content.replace(
            'getAllProducts()',
            'getAllProductsNoPagination()'
        )
        
        if content != updated_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(updated_content)
            print(f"✅ Fixed: {file_path}")
        else:
            print(f"⏭️  Skipped (no changes): {file_path}")
            
    except Exception as e:
        print(f"❌ Error fixing {file_path}: {e}")

print("\n✅ Batch fix completed!")
