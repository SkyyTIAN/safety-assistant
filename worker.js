/**
 * Feishu Export Cloudflare Worker
 * 
 * 功能：接收网页传来的文档内容，创建飞书云文档
 * 部署方式：Cloudflare Workers
 * 
 * 环境变量（需要在 Cloudflare Worker 设置）：
 *   FEISHU_APP_ID     - 飞书应用 App ID (cli_xxx)
 *   FEISHU_APP_SECRET - 飞书应用 App Secret
 */

const FEISHU_APP_ID = FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = FEISHU_APP_SECRET || '';

// 缓存 token，避免频繁请求
let tokenCache = null;
let tokenExpire = 0;

async function getTenantAccessToken() {
    if (tokenCache && Date.now() < tokenExpire) {
        return tokenCache;
    }

    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            app_id: FEISHU_APP_ID,
            app_secret: FEISHU_APP_SECRET
        })
    });

    const data = await response.json();
    if (data.code !== 0) {
        throw new Error(`获取 token 失败: ${data.msg}`);
    }

    tokenCache = data.tenant_access_token;
    tokenExpire = Date.now() + (data.expire - 60) * 1000; // 提前1分钟过期
    return tokenCache;
}

async function createFeishuDocument(token, title, content) {
    // 1. 创建空白文档
    const createResponse = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title })
    });

    const createData = await createResponse.json();
    if (createData.code !== 0) {
        throw new Error(`创建文档失败: ${createData.msg}`);
    }

    const documentId = createData.data.document.document_id;

    // 2. 将 Markdown 内容转换为飞书块
    const blocks = markdownToFeishuBlocks(content);

    // 3. 插入内容到文档
    if (blocks.length > 0) {
        await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                children: blocks,
                index: 0
            })
        });
    }

    return documentId;
}

function markdownToFeishuBlocks(markdown) {
    const blocks = [];
    const lines = markdown.split('\n');
    let inCodeBlock = false;
    let codeContent = [];

    for (let line of lines) {
        // 代码块处理
        if (line.startsWith('```')) {
            if (inCodeBlock) {
                blocks.push({
                    block_type: 12, // code block
                    code: {
                        elements: [{ text: { content: codeContent.join('\n'), text_element_style: {} } }],
                        style: { language: 1 }
                    }
                });
                codeContent = [];
            }
            inCodeBlock = !inCodeBlock;
            continue;
        }

        if (inCodeBlock) {
            codeContent.push(line);
            continue;
        }

        // 标题处理
        if (line.startsWith('# ')) {
            blocks.push({
                block_type: 2, // heading1
                heading1: {
                    elements: [{ text: { content: line.slice(2), text_element_style: {} } }],
                    style: {}
                }
            });
        } else if (line.startsWith('## ')) {
            blocks.push({
                block_type: 3, // heading2
                heading2: {
                    elements: [{ text: { content: line.slice(3), text_element_style: {} } }],
                    style: {}
                }
            });
        } else if (line.startsWith('### ')) {
            blocks.push({
                block_type: 4, // heading3
                heading3: {
                    elements: [{ text: { content: line.slice(4), text_element_style: {} } }],
                    style: {}
                }
            });
        }
        // 表格处理（简化）
        else if (line.startsWith('|')) {
            // 跳过表格分隔行
            if (line.match(/^\|[-| :]+\|$/)) continue;
            
            const cells = line.split('|').filter(c => c.trim());
            const tableRows = [cells.map(c => ({
                elements: [{ text: { content: c.trim(), text_element_style: {} } }],
                style: {}
            }))];
            
            blocks.push({
                block_type: 13, // table
                table: {
                    rows: [{
                        cells: tableRows
                    }],
                    property: {
                        row_size: 1,
                        column_size: cells.length,
                        header_row: true
                    }
                }
            });
        }
        // 列表处理
        else if (line.startsWith('- ') || line.startsWith('* ')) {
            blocks.push({
                block_type: 7, // bullet
                bullet: {
                    elements: [{ text: { content: line.slice(2), text_element_style: {} } }],
                    style: { alignment: 1 }
                }
            });
        }
        // 普通段落
        else if (line.trim()) {
            blocks.push({
                block_type: 2, // paragraph (use text for simplicity)
                text: {
                    elements: [{ text: { content: line, text_element_style: {} } }],
                    style: {}
                }
            });
        }
        // 空行
        else {
            blocks.push({
                block_type: 2,
                text: {
                    elements: [{ text: { content: ' ', text_element_style: {} } }],
                    style: {}
                }
            });
        }
    }

    return blocks;
}

async function handleRequest(request) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ success: false, message: '仅支持 POST 请求' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
            throw new Error('未配置飞书应用凭证');
        }

        const body = await request.json();
        const { title, content } = body;

        if (!title || !content) {
            throw new Error('缺少 title 或 content 参数');
        }

        const token = await getTenantAccessToken();
        const documentId = await createFeishuDocument(token, title, content);

        return new Response(JSON.stringify({
            success: true,
            data: {
                document_id: documentId,
                url: `https://feishu.cn/docx/${documentId}`
            }
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});
