// 用户配置区域开始 =================================

// GitLab 节点配置
const GITLAB_CONFIGS = [
  { name: '', id: '', token: '' },  // GitLab 账户1
  { name: '', id: '', token: '' },  // GitLab 账户2
  { name: '', id: '', token: '' },  // GitLab 账户3
  { name: '', id: '', token: '' },  // GitLab 账户4
];

// GitHub 配置
const GITHUB_USERNAME = '';  // GitHub 用户名
const GITHUB_PAT = '';  // GitHub 个人访问令牌

// R2 存储配置
const R2_CONFIGS = [
  {
    name: '',  // 帐户1 ID
    accountId: '',  // 帐户1 访问密钥 ID
    accessKeyId: '',  // 帐户1 机密访问密钥
    secretAccessKey: '',  // 帐户1 机密访问密钥
    bucket: '' // 帐户1 R2 存储桶名称
  },
  {
    name: '',  // 帐户2 ID
    accountId: '',  // 帐户2 访问密钥 ID
    accessKeyId: '',  // 帐户2 机密访问密钥
    secretAccessKey: '',  // 帐户2 机密访问密钥
    bucket: '' // 帐户2 R2 存储桶名称
  },
  // 可以添加更多 R2 配置
];

// B2 存储配置
const B2_CONFIGS = [
  {
    name: '',  // 帐户1 名
    endPoint: '',  // 账户1 Endpoint
    keyId: '',  // 账户1 keyID
    applicationKey: '',  // 账户1 applicationKey
    bucket: ''  // 账户1桶名 bucketName
  },
  {
    name: '',  // 帐户2 名
    endPoint: '',  // 账户2 Endpoint
    keyId: '',  // 账户2 keyID
    applicationKey: '',  // 账户2 applicationKey
    bucket: ''  // 账户2桶名 bucketName
  },
  // 可以添加更多 B2 配置
];

// 定义集群访问目录
const DIR = '';

// 定义集群里全部节点连接状态的密码验证，区分大小写（优先使用自定义密码，若为空则使用 GITHUB_PAT）
const CHECK_PASSWORD = '' || GITHUB_PAT;

// GitHub 备份策略
const STRATEGY = 'size'  // 可选 [size (默认) | quantity | 指定节点]; size: 选择容量最少的仓库来存储文件; quantity: 选择文件最少的仓库来存储文件; 指定节点: 比如  pic1 或者 pic2
const DELETE = 'true'  // 可选 [true (默认) | false]，已复制到 GitHub 的文件，是否从 R2 删除

// 用户配置区域结束 =================================

// AWS SDK 签名相关函数开始 =================================

// 获取签名URL
async function getSignedUrl(config, method, path) {
  const region = 'auto';
  const service = 's3';

  // 根据配置类型确定 host 和认证信息
  const host = config.endPoint
    ? config.endPoint  // B2 配置使用 endPoint
    : `${config.accountId}.r2.cloudflarestorage.com`;  // R2 配置使用默认格式

  // 根据配置类型确定认证信息
  const accessKeyId = config.endPoint ? config.keyId : config.accessKeyId;
  const secretKey = config.endPoint ? config.applicationKey : config.secretAccessKey;

  const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = datetime.substr(0, 8);

  const canonicalRequest = [
    method,
    '/' + path,
    '',
    `host:${host}`,
    'x-amz-content-sha256:UNSIGNED-PAYLOAD',
    `x-amz-date:${datetime}`,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    `${date}/${region}/${service}/aws4_request`,
    await sha256(canonicalRequest)
  ].join('\n');

  const signature = await getSignature(
    secretKey,  // 使用映射后的密钥
    date,
    region,
    service,
    stringToSign
  );

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${date}/${region}/${service}/aws4_request`,  // 使用映射后的密钥ID
    `SignedHeaders=host;x-amz-content-sha256;x-amz-date`,
    `Signature=${signature}`
  ].join(', ');

  return {
    url: `https://${host}/${path}`,
    headers: {
      'Authorization': authorization,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': datetime,
      'Host': host
    }
  };
}

// SHA256 哈希函数
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  }

  // HMAC-SHA256 函数
  async function hmacSha256(key, message) {
  const keyBuffer = key instanceof ArrayBuffer ? key : new TextEncoder().encode(key);
  const messageBuffer = new TextEncoder().encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageBuffer
  );

  return signature;
  }

  // 获取签名
  async function getSignature(secret, date, region, service, stringToSign) {
  const kDate = await hmacSha256('AWS4' + secret, date);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256(kSigning, stringToSign);

  return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const from = url.searchParams.get('from')?.toLowerCase();

    // 只在没有 from 参数时才检查和使用缓存
    let cacheResponse;
    if (!from) {
      // 检查缓存
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;
      cacheResponse = await cache.match(cacheKey);

      if (cacheResponse) {
        return cacheResponse;
      }
    }

    // 直接使用 GITLAB_CONFIGS 中的 name 作为 GitHub 仓库名
    const githubRepos = GITLAB_CONFIGS.map(config => config.name);

    const FILE = url.pathname.split('/').pop();

    if (url.pathname === `/${CHECK_PASSWORD}`) {
      const response = await listProjects(GITLAB_CONFIGS, githubRepos, GITHUB_USERNAME, GITHUB_PAT);
      // 不缓存状态检查页面
      return response;
    }

    const startTime = Date.now();

    // 根据不同的访问方式构建请求
    let requests = [];

    // 在生成请求时需要合并 R2 和 B2 的请求
    const generateStorageRequests = async () => {
      const r2Requests = await Promise.all(R2_CONFIGS.map(async (r2Config) => {
        const r2Path = `${r2Config.bucket}/${DIR}/${FILE}`;
        const signedRequest = await getSignedUrl(r2Config, 'GET', r2Path);
        return {
          url: signedRequest.url,
          headers: signedRequest.headers,
          source: 'r2',
          repo: `${r2Config.name} (${r2Config.bucket})`
        };
      }));

      const b2Requests = await Promise.all(B2_CONFIGS.map(async (b2Config) => {
        const b2Path = `${b2Config.bucket}/${DIR}/${FILE}`;
        const signedRequest = await getSignedUrl(b2Config, 'GET', b2Path);
        return {
          url: signedRequest.url,
          headers: signedRequest.headers,
          source: 'b2',
          repo: `${b2Config.name} (${b2Config.bucket})`
        };
      }));

      return [...r2Requests, ...b2Requests];
    };

    if (from === 'where') {
      // 获取文件信息模式
      const githubRequests = githubRepos.map(repo => ({
        url: `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${DIR}/${FILE}`,
        headers: {
          'Authorization': `token ${GITHUB_PAT}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Cloudflare Worker'
        },
        source: 'github',
        repo: repo,
        processResponse: async (response) => {
          if (!response.ok) throw new Error('Not found');
          const data = await response.json();
          return {
            size: data.size,
            exists: true
          };
        }
      }));

      const gitlabRequests = GITLAB_CONFIGS.map(config => ({
        url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}?ref=main`,
        headers: {
          'PRIVATE-TOKEN': config.token
        },
        source: 'gitlab',
        repo: config.name,
        processResponse: async (response) => {
          if (!response.ok) throw new Error('Not found');
          const data = await response.json();
          const size = atob(data.content).length;
          return {
            size: size,
            exists: true
          };
        }
      }));

      const r2Requests = await generateStorageRequests();
      const r2WhereRequests = r2Requests.map(request => ({
        ...request,
        processResponse: async (response) => {
          if (!response.ok) throw new Error('Not found');
          const size = response.headers.get('content-length');
          return {
            size: parseInt(size),
            exists: true
          };
        }
      }));

      requests = [...githubRequests, ...gitlabRequests, ...r2WhereRequests];

    } else {
      // 获取文件内容模式
      if (from === 'github') {
        requests = githubRepos.map(repo => ({
          url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo
        }));
      } else if (from === 'gitlab') {
        requests = GITLAB_CONFIGS.map(config => ({
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name
        }));
      } else if (from === 'r2') {
        // 只从 R2 存储获取
        requests = await Promise.all(R2_CONFIGS.map(async (r2Config) => {
          const r2Path = `${r2Config.bucket}/${DIR}/${FILE}`;
          const signedRequest = await getSignedUrl(r2Config, 'GET', r2Path);
          return {
            url: signedRequest.url,
            headers: signedRequest.headers,
            source: 'r2',
            repo: `${r2Config.name} (${r2Config.bucket})`
          };
        }));
      } else if (from === 'b2') {
        // 只从 B2 存储获取
        requests = await Promise.all(B2_CONFIGS.map(async (b2Config) => {
          const b2Path = `${b2Config.bucket}/${DIR}/${FILE}`;
          const signedRequest = await getSignedUrl(b2Config, 'GET', b2Path);
          return {
            url: signedRequest.url,
            headers: signedRequest.headers,
            source: 'b2',
            repo: `${b2Config.name} (${b2Config.bucket})`
          };
        }));
      } else {
        // 如果没有指定来源，则从所有源获取
        const githubRequests = githubRepos.map(repo => ({
          url: `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${repo}/main/${DIR}/${FILE}`,
          headers: {
            'Authorization': `token ${GITHUB_PAT}`,
            'User-Agent': 'Cloudflare Worker'
          },
          source: 'github',
          repo: repo
        }));

        const gitlabRequests = GITLAB_CONFIGS.map(config => ({
          url: `https://gitlab.com/api/v4/projects/${config.id}/repository/files/${encodeURIComponent(`${DIR}/${FILE}`)}/raw?ref=main`,
          headers: {
            'PRIVATE-TOKEN': config.token
          },
          source: 'gitlab',
          repo: config.name
        }));

        const r2Requests = await generateStorageRequests();

        requests = [...githubRequests, ...gitlabRequests, ...r2Requests];
      }
    }

    // 发送请求并处理响应
    const fetchPromises = requests.map(request => {
      const { url, headers, source, repo, processResponse } = request;

      return fetch(new Request(url, {
        method: 'GET',
        headers: headers
      })).then(async response => {
        if (from === 'where' && typeof processResponse === 'function') {
          // 使用 `processResponse` 处理 where 查询逻辑
          try {
            const result = await processResponse(response);
            const endTime = Date.now();
            const duration = endTime - startTime;

            const formattedSize = result.size > 1024 * 1024
              ? `${(result.size / (1024 * 1024)).toFixed(2)} MB`
              : `${(result.size / 1024).toFixed(2)} kB`;

            return {
              fileName: FILE,
              size: formattedSize,
              source: `${source} (${repo})`,
              duration: `${duration}ms`
            };
          } catch (error) {
            throw new Error(`Not found in ${source} (${repo})`);
          }
        } else {
          // 对于内容获取，直接返回响应
          if (!response.ok) {
            throw new Error(`Not found in ${source} (${repo})`);
          }
          return response;
        }
      }).catch(error => {
        throw new Error(`Error in ${source} (${repo}): ${error.message}`);
      });
    });

    try {
      if (requests.length === 0) {
        throw new Error('No valid source specified');
      }

      const result = await Promise.any(fetchPromises);

      let response;
      if (from === 'where') {
        // 如果是 where 查询，返回 JSON 格式响应
        response = new Response(JSON.stringify(result, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } else if (result instanceof Response) {
        // 先读取响应体
        const blob = await result.blob();

        // 创建新的响应，设置适当的头部
        const headers = {
          'Content-Type': result.headers.get('Content-Type') || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        };

        // 如果有 from 参数，添加禁止缓存的头部
        if (from) {
          headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
          headers['Pragma'] = 'no-cache';
          headers['Expires'] = '0';
        }

        response = new Response(blob, {
          status: 200,
          headers: headers
        });
      } else {
        throw new Error("Unexpected result type");
      }

      // 只在没有 from 参数且不是 where 查询时才缓存响应
      if (!from && from !== 'where') {
        const cacheUrl = new URL(request.url);
        const cacheKey = new Request(cacheUrl.toString(), request);
        const cache = caches.default;
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }

      return response;

    } catch (error) {
      const sourceText = from === 'where'
        ? 'in any repository'
        : from
          ? `from ${from}`
          : 'in the GitHub, GitLab, R2, and B2 storage';

      const errorResponse = new Response(
        `404: Cannot find the ${FILE} ${sourceText}.`,
        {
          status: 404,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );

      return errorResponse;
    }
  }
};

// 列出所有节点仓库状态
async function listProjects(gitlabConfigs, githubRepos, githubUsername, githubPat) {
  let result = 'GitHub, GitLab, R2 and B2 Storage status:\n\n';

  try {
    // 并发执行所有检查
    const [username, ...allChecks] = await Promise.all([
      getGitHubUsername(githubPat),
      ...githubRepos.map(repo =>
        checkGitHubRepo(githubUsername, repo, githubPat)
      ),
      ...gitlabConfigs.map(config =>
        checkGitLabProject(config.id, config.token)
      ),
      ...R2_CONFIGS.map(config =>
        checkR2Storage(config)
      ),
      ...B2_CONFIGS.map(config =>
        checkB2Storage(config)
      )
    ]);

    // 计算各类检查结果的数量和起始位置
    const githubCount = githubRepos.length;
    const gitlabCount = gitlabConfigs.length;
    const r2Count = R2_CONFIGS.length;
    const b2Count = B2_CONFIGS.length;

    // 分割检查结果
    const githubResults = allChecks.slice(0, githubCount);
    const gitlabResults = allChecks.slice(githubCount, githubCount + gitlabCount);
    const r2Results = allChecks.slice(githubCount + gitlabCount, githubCount + gitlabCount + r2Count);
    const b2Results = allChecks.slice(githubCount + gitlabCount + r2Count);

    // 添加 GitHub 结果
    githubRepos.forEach((repo, index) => {
      const [status, fileCount, totalSize] = githubResults[index];
      const formattedSize = formatSize(totalSize);
      result += `GitHub: ${repo} - ${status} (Username: ${username}, Files: ${fileCount}, Size: ${formattedSize})\n`;
    });

    // 添加 GitLab 结果
    gitlabConfigs.forEach((config, index) => {
      const [status, username, fileCount] = gitlabResults[index];
      result += `GitLab: Project ID ${config.id} - ${status} (Username: ${username}, Files: ${fileCount})\n`;
    });

    // 添加 R2 结果
    r2Results.forEach(([status, name, bucket, fileCount, totalSize]) => {
      result += `R2 Storage: ${name} - ${status} (Bucket: ${bucket}, Files: ${fileCount}, Size: ${totalSize})\n`;
    });

    // 添加 B2 结果
    b2Results.forEach(([status, name, bucket, fileCount, totalSize]) => {
      result += `B2 Storage: ${name} - ${status} (Bucket: ${bucket}, Files: ${fileCount}, Size: ${totalSize})\n`;
    });

  } catch (error) {
    result += `Error during status check: ${error.message}\n`;
  }

  return new Response(result, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// 文件大小格式化函数
function formatSize(sizeInBytes) {
  if (sizeInBytes >= 1024 * 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (sizeInBytes >= 1024 * 1024) {
    return `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(sizeInBytes / 1024).toFixed(2)} kB`;
  }
}

// 获取 GitHub 用户名的异步函数
async function getGitHubUsername(pat) {
  const url = 'https://api.github.com/user';  // GitHub 用户信息 API 地址
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${pat}`,  // 使用个人访问令牌进行授权
        'Accept': 'application/vnd.github.v3+json',  // 指定接受的响应格式
        'User-Agent': 'Cloudflare Worker'  // 用户代理
      }
    });

    // 如果响应状态为 200，表示成功
    if (response.status === 200) {
      const data = await response.json();  // 解析 JSON 数据
      return data.login;  // 返回用户登录名
    } else {
      console.error('GitHub API Error:', response.status);  // 记录错误状态
      return 'Unknown';  // 返回未知状态
    }
  } catch (error) {
    console.error('GitHub request error:', error);  // 记录请求错误
    return 'Error';  // 返回错误状态
  }
}

// 检查 GitHub 仓库的异步函数
async function checkGitHubRepo(owner, repo, pat) {
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${DIR}`; // 直接检查指定目录

  const headers = {
    'Authorization': `token ${pat}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare Worker'
  };

  try {
    // 并发请求获取仓库信息和目录内容
    const [repoResponse, contentsResponse] = await Promise.all([
      fetch(repoUrl, { headers }),
      fetch(contentsUrl, { headers })
    ]);

    const repoData = await repoResponse.json();

    if (repoResponse.status !== 200) {
      throw new Error(`Repository error: ${repoData.message}`);
    }

    if (contentsResponse.status !== 200) {
      return [`working (${repoData.private ? 'private' : 'public'})`, 0, 0];
    }

    const contentsData = await contentsResponse.json();

    // 计算文件数量和总大小
    const fileStats = contentsData.reduce((acc, item) => {
      if (item.type === 'file') {
        return {
          count: acc.count + 1,
          size: acc.size + (item.size || 0)
        };
      }
      return acc;
    }, { count: 0, size: 0 });

    return [
      `working (${repoData.private ? 'private' : 'public'})`,
      fileStats.count,
      fileStats.size
    ];

  } catch (error) {
    console.error(`Error checking GitHub repo ${repo}:`, error);
    return [`error: ${error.message}`, 0, 0];
  }
}

// 检查 GitLab 项目的异步函数
async function checkGitLabProject(projectId, pat) {
  const projectUrl = `https://gitlab.com/api/v4/projects/${projectId}`;
  const filesUrl = `https://gitlab.com/api/v4/projects/${projectId}/repository/tree?ref=main&path=${DIR}&recursive=true&per_page=10000`;

  try {
    const [projectResponse, filesResponse] = await Promise.all([
      fetch(projectUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      }),
      fetch(filesUrl, {
        headers: { 'PRIVATE-TOKEN': pat }
      })
    ]);

    if (projectResponse.status === 200) {
      const projectData = await projectResponse.json();
      let fileCount = 0;

      if (filesResponse.status === 200) {
        const filesData = await filesResponse.json();
        fileCount = filesData.filter(item => item.type === 'blob').length;
      }

      return [
        `working (${projectData.visibility})`,
        projectData.owner.username,
        fileCount
      ];
    } else if (projectResponse.status === 404) {
      return ['not found', 'Unknown', 0];
    } else {
      return ['disconnect', 'Unknown', 0];
    }
  } catch (error) {
    console.error('GitLab project check error:', error);
    return ['disconnect', 'Error', 0];
  }
}

// 检查 R2 存储状态
async function checkR2Storage(r2Config) {
  try {
    // 1. 列出目录下所有文件
    const listPath = `${r2Config.bucket}`;  // 列出根目录
    const signedRequest = await getSignedUrl(r2Config, 'GET', listPath);

    const response = await fetch(signedRequest.url, {
      headers: signedRequest.headers
    });

    let fileCount = 0;
    let totalSize = 0;

    if (response.ok) {
      const data = await response.text();
      // 解析 XML 响应
      const keys = data.match(/<Key>([^<]+)<\/Key>/g) || [];
      const sizes = data.match(/<Size>(\d+)<\/Size>/g) || [];

      // 只计算指定目录下的文件
      keys.forEach((key, index) => {
        const filePath = key.replace(/<Key>|<\/Key>/g, '');
        if (filePath.startsWith(DIR + '/')) {
          fileCount++;
          const size = parseInt(sizes[index]?.replace(/<Size>|<\/Size>/g, '') || String(0), 10);
          totalSize += size;
        }
      });
    }

    // 即使文件不存在，只要能访问到存储桶就认为是正常的
    const status = response.ok ? 'working' : 'error';

    return [
      status,
      r2Config.name,
      r2Config.bucket,
      fileCount,
      formatSize(totalSize)
    ];
  } catch (error) {
    console.error('R2 Storage error:', error);
    return ['error', r2Config.name, 'connection failed', 0, '0 B'];
  }
}

// 检查 B2 存储状态
async function checkB2Storage(b2Config) {
  try {
    // 1. 列出目录下所有文件
    const listPath = `${b2Config.bucket}`;  // 列出根目录
    const signedRequest = await getSignedUrl(b2Config, 'GET', listPath);

    const response = await fetch(signedRequest.url, {
      headers: signedRequest.headers
    });

    let fileCount = 0;
    let totalSize = 0;

    if (response.ok) {
      const data = await response.text();
      // 解析 XML 响应
      const keys = data.match(/<Key>([^<]+)<\/Key>/g) || [];
      const sizes = data.match(/<Size>(\d+)<\/Size>/g) || [];

      // 只计算指定目录下的文件
      keys.forEach((key, index) => {
        const filePath = key.replace(/<Key>|<\/Key>/g, '');
        if (filePath.startsWith(DIR + '/')) {
          fileCount++;
          const size = parseInt(sizes[index]?.replace(/<Size>|<\/Size>/g, '') || String(0), 10);
          totalSize += size;
        }
      });
    }

    // 即使文件不存在，只要能访问到存储桶就认为是正常的
    const status = (response.status === 404 || response.status === 403 || response.ok) ? 'working' : 'error';

    return [
      status,
      b2Config.name,
      b2Config.bucket,
      fileCount,
      formatSize(totalSize)
    ];
  } catch (error) {
    console.error('B2 Storage error:', error);
    return ['error', b2Config.name, 'connection failed', 0, '0 B'];
  }
}