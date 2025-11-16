const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// console.log("🔧 Đang fix lỗi @angular/build cho các Angular projects...\n");

const angularProjects = ["my-user", "my-admin"];

angularProjects.forEach((projectName) => {
  const projectPath = path.resolve(projectName);

  if (!fs.existsSync(path.join(projectPath, "package.json"))) {
    // console.log(`⚠️  Bỏ qua ${projectName}: Không tìm thấy package.json`);
    return;
  }

  // console.log(`\n🔨 Đang fix ${projectName}...`);

  try {
    // Xóa node_modules và package-lock.json nếu có
    const nodeModulesPath = path.join(projectPath, "node_modules");
    const packageLockPath = path.join(projectPath, "package-lock.json");

    if (fs.existsSync(nodeModulesPath)) {
      // console.log(`   Xóa node_modules...`);
      try {
        fs.rmSync(nodeModulesPath, { recursive: true, force: true });
      } catch (err) {
        // console.log(
        //   `   ⚠️  Không thể xóa node_modules (có thể đang được sử dụng): ${err.message}`
        // );
      }
    }

    if (fs.existsSync(packageLockPath)) {
      // console.log(`   Xóa package-lock.json...`);
      fs.unlinkSync(packageLockPath);
    }

    // Cài đặt lại với đầy đủ devDependencies
    // console.log(`   Cài đặt lại dependencies...`);
    execSync("npm install --include=dev --force", {
      cwd: projectPath,
      stdio: "inherit",
      shell: true,
    });

    // console.log(`✅ Hoàn thành fix cho ${projectName}`);
  } catch (error) {
    // console.error(`❌ Lỗi khi fix ${projectName}:`, error.message);
  }
});

// console.log("\n🎉 Hoàn thành fix! Bây giờ bạn có thể chạy npm start.");
