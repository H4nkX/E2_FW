const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 请求体
app.use(express.json());

// 企业微信 webhook 配置
const webhooks = {
  default: {
    url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=f9d8171b-5d6f-4be2-a094-3a4aa65b7f27'
  }
  // 可以在这里添加更多 webhook 配置
  // 例如：
  // another: {
  //   url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=another-key'
  // }
};

// 频率限制：存储每个 webhook 的调用记录
const rateLimit = {
  windowMs: 60000, // 1分钟窗口
  max: 50, // 每分钟最多50次调用（低于企业微信60次的限制）
  calls: {} // 存储调用记录
};

// 检查频率限制
function checkRateLimit(webhookName) {
  const now = Date.now();
  if (!rateLimit.calls[webhookName]) {
    rateLimit.calls[webhookName] = [];
  }
  
  // 清理过期的调用记录
  rateLimit.calls[webhookName] = rateLimit.calls[webhookName].filter(timestamp => now - timestamp < rateLimit.windowMs);
  
  // 检查是否超过限制
  if (rateLimit.calls[webhookName].length >= rateLimit.max) {
    return false;
  }
  
  // 记录新的调用
  rateLimit.calls[webhookName].push(now);
  return true;
}

// 发送消息到企业微信的函数
function sendToWechat(webhookUrl, message) {
  return new Promise((resolve, reject) => {
    try {
      const postData = JSON.stringify(message);
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const req = https.request(webhookUrl, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (parseError) {
            reject(new Error(`Invalid response from WeChat: ${data}`));
          }
        });
      });
      
      req.on('error', (e) => {
        reject(e);
      });
      
      req.write(postData);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

// 发送文本消息的路由
app.post('/api/send/:webhook?', async (req, res) => {
  try {
    const webhookName = req.params.webhook || 'default';
    const webhook = webhooks[webhookName];
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    // 检查频率限制
    if (!checkRateLimit(webhookName)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    
    // 验证请求体
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body. Must be a JSON object.' });
    }
    
    const { content, mentioned_list = [], mentioned_mobile_list = [] } = req.body;
    
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Content is required and must be a non-empty string.' });
    }
    
    // 确保 mentioned_list 和 mentioned_mobile_list 是数组
    const safeMentionedList = Array.isArray(mentioned_list) ? mentioned_list : [];
    const safeMentionedMobileList = Array.isArray(mentioned_mobile_list) ? mentioned_mobile_list : [];
    
    // 构建消息对象
    const message = {
      msgtype: 'text',
      text: {
        content: content.trim(),
        mentioned_list: safeMentionedList,
        mentioned_mobile_list: safeMentionedMobileList
      }
    };
    
    // 发送消息到企业微信
    const result = await sendToWechat(webhook.url, message);
    
    // 检查企业微信返回的错误
    if (result.errcode !== 0) {
      console.error(`WeChat API error (${webhookName}):`, result);
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// 发送 Markdown 消息的路由
app.post('/api/send/markdown/:webhook?', async (req, res) => {
  try {
    const webhookName = req.params.webhook || 'default';
    const webhook = webhooks[webhookName];
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    // 检查频率限制
    if (!checkRateLimit(webhookName)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    
    // 验证请求体
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body. Must be a JSON object.' });
    }
    
    const { content } = req.body;
    
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Content is required and must be a non-empty string.' });
    }
    
    // 构建消息对象
    const message = {
      msgtype: 'markdown',
      markdown: {
        content: content.trim()
      }
    };
    
    // 发送消息到企业微信
    const result = await sendToWechat(webhook.url, message);
    
    // 检查企业微信返回的错误
    if (result.errcode !== 0) {
      console.error(`WeChat API error (${webhookName}):`, result);
      return res.status(400).json(result);
    }
    
    res.json(result);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// 根路径路由 - GET 请求
app.get('/', (req, res) => {
  res.send('请调用 POST 请求来发送消息');
});

// 根路径路由 - POST 请求（处理 TrendMiner 的调用）
app.post('/', async (req, res) => {
  try {
    // 默认使用 default webhook
    const webhook = webhooks.default;
    
    // 检查频率限制
    if (!checkRateLimit('default')) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    
    // 获取当前时间
    const now = new Date();
    const timestamp = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Shanghai'
    });
    
    // 处理 TrendMiner 发送的复杂 JSON 对象
    let content = 'TrendMiner 触发了 webhook 调用';
    
    if (req.body && typeof req.body === 'object') {
      // 从 TrendMiner 的 JSON 中提取有用信息
      const { 
        resultId, 
        resultScore, 
        resultUrl, 
        searchName, 
        webhookCallEvent, 
        webhookCallTime 
      } = req.body;
      
      // 构建有意义的消息内容
      content = `TrendMiner 监控告警\n` +
                `事件类型: ${webhookCallEvent || '未知'}\n` +
                `结果 ID: ${resultId || '未知'}\n` +
                `结果分数: ${resultScore || '未知'}\n` +
                `搜索名称: ${searchName || '未知'}\n` +
                `触发时间: ${webhookCallTime || '未知'}\n` +
                `查看详情: ${resultUrl || '无链接'}`;
    } else if (req.body && typeof req.body === 'string') {
      // 如果请求体是字符串，直接使用
      content = req.body.trim();
    }
    
    // 构建消息对象
    const message = {
      msgtype: 'text',
      text: {
        content: `请注意有问题\n${content}\n时间：${timestamp}`
      }
    };
    
    // 发送消息到企业微信
    const result = await sendToWechat(webhook.url, message);
    
    // 记录企业微信返回的结果
    console.log('WeChat API response:', result);
    
    // 无论企业微信返回什么，都返回 200 状态码给 TrendMiner
    res.status(200).json({
      status: 'ok',
      message: '消息已发送',
      wechatResult: result
    });
  } catch (error) {
    console.error('Server error:', error);
    // 即使发生错误，也返回 200 状态码给 TrendMiner
    res.status(200).json({
      status: 'ok',
      message: '消息发送过程中出现错误，但已记录',
      error: error.message
    });
  }
});

// Vercel 会自动处理服务器启动，不需要手动调用 app.listen()
module.exports = app;