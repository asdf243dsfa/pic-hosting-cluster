# R2，GitHub 和 GitLab 分布式存储集群

- **方案的配置文件都是 `config.yml`，只需要根据实际修改**

## GitHub --→ GitLab 目录下2个文件，放到 GitHub 库: 
- **配置文件**: `config.yml`
- **AC 脚本**: `./github/workflows/cluster_sync.yml`

## GitLab --→ GitHub 目录下3个文件，放到 GitLab 库: 
- **配置文件**: `config.yml`
- **同步脚本**: `sync_to_github.sh`
- **CI/CD 脚本**: `.gitlab-ci.yml`

## R2 --→ GitHub 目录下2个文件，放到 GitHub 库: 
- **AC 脚本**: `./github/workflows/r2_to_github.yml`
- **设置3个secrets: `ACCOUNT_ID`, `WORKER_NAME` 和 `API_TOKEN`

## S2 (R2+B2) --→ GitHub 目录下2个文件，放到 GitHub 库: 
- **AC 脚本**: `./github/workflows/s3_to_github.yml`
- **设置3个secrets: `ACCOUNT_ID`, `WORKER_NAME` 和 `API_TOKEN`

## ACCOUNT_ID,WORKER_NAME,API_TOKEN 获取方式

### 在 Cloudflare 面板创建可以读取 Worker 项目的 API, https://dash.cloudflare.com/profile/api-tokens

![image](https://github.com/user-attachments/assets/9e49b29a-54ae-46f0-aeda-28d95f4a9041)
![image](https://github.com/user-attachments/assets/11dceb4b-ab2e-41a8-b8e4-7317bcf4b50f)
![image](https://github.com/user-attachments/assets/b1e6f1c3-3d8d-4ba3-8d98-35ab4f061b14)
![image](https://github.com/user-attachments/assets/81e66642-cd5c-43d3-bb72-7fecf24e16a3)
![image](https://github.com/user-attachments/assets/3c832e81-bfc6-480d-939c-1d0731a07c17)

### 在 Action 处设置 3 个 secret 变量

![image](https://github.com/user-attachments/assets/25b8d0fa-8302-4cb9-a6db-83e449e9664c)

## Cloudflare worker 目录下5个文件，复制代码到 worker 处：
- **只使用 GitHub**: `github_only.js`
- **只使用 GitLab**: `gitlab_only.js`
- **同时使用 GitHub 和 GitLab**: `github_gitlab.js`
- **同时使用 GitHub, GitLab 和 R2**: `github_gitlab_r2.js`
- **同时使用 GitHub, GitLab，R2 和 B2**: `github_gitlab_s3.js`

## 检测节点状态 `https://<自定义域名>/<GitHub PAT>`

<img width="670" alt="image" src="https://github.com/user-attachments/assets/7a518dfc-7c56-4c30-bd23-d2766f39a3a8">

## 检测文件信息
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=where`

## 指定文件获取平台
- **从 GitHub 获取** `https://<自定义域名>/<文件名>?from=github`

- **从 GitLab 获取** `https://<自定义域名>/<文件名>?from=gitlab`

- **从 Cloudflare R2 获取** `https://<自定义域名>/<文件名>?from=r2`

- **从 Backblaze B2 获取** `https://<自定义域名>/<文件名>?from=b2`