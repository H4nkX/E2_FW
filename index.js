const express = require('express');
const https = require('https');
const app = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 请求体
app.use(express.json());

// 企业微信 webhook 配置
const webhooks = {
  default: {
    url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=ccd8e20d-a6b0-40dc-bb39-3737332840bd'
  }
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

// 时间转换为北京时间（UTC+8），格式：YYYY-MM-DD HH:mm:ss
const convertToBeijingTime = (timeStr) => {
  if (!timeStr) return "未指定";
  try {
    let time = Number(timeStr);
    // 处理10位秒级/13位毫秒级时间戳
    if (!isNaN(time)) {
      time = time.toString().length === 10 ? time * 1000 : time;
    } else {
      time = new Date(timeStr).getTime();
    }
    // 格式化输出北京时间
    return new Date(time).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch (e) {
    return "时间格式异常";
  }
};

// 发送文本消息的路由
app.post('/api/send/:webhook?', async (req, res) => {
  try {
    const webhookName = req.params.webhook || 'default';
    const webhook = webhooks[webhookName];
    
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }
    
    if (!checkRateLimit(webhookName)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body. Must be a JSON object.' });
    }
    
    const { content, mentioned_list = [], mentioned_mobile_list = [] } = req.body;
    
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Content is required and must be a non-empty string.' });
    }
    
    const safeMentionedList = Array.isArray(mentioned_list) ? mentioned_list : [];
    const safeMentionedMobileList = Array.isArray(mentioned_mobile_list) ? mentioned_mobile_list : [];
    
    const message = {
      msgtype: 'text',
      text: {
        content: content.trim(),
        mentioned_list: safeMentionedList,
        mentioned_mobile_list: safeMentionedMobileList
      }
    };
    
    const result = await sendToWechat(webhook.url, message);
    
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
    
    if (!checkRateLimit(webhookName)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body. Must be a JSON object.' });
    }
    
    const { content } = req.body;
    
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Content is required and must be a non-empty string.' });
    }
    
    const message = {
      msgtype: 'markdown',
      markdown: {
        content: content.trim()
      }
    };
    
    const result = await sendToWechat(webhook.url, message);
    
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
    
    // 处理 TrendMiner 发送的 JSON 对象，只保留指定的5个字段
    let alertMessage = '';
    
    if (req.body && typeof req.body === 'object') {
      // 只提取你指定的5个字段
      const { 
        searchName, 
        webhookCallEvent, 
        searchType, 
        resultStart, 
        resultEnd 
      } = req.body;
      
      // 完全按照你给的格式构建告警内容，只保留这5个字段
      alertMessage = [
        `Search Name: ${searchName || "未指定"}`,
        `Event Type: ${webhookCallEvent || "未指定"}`,
        `Search Type: ${searchType || "未指定"}`,
        `Start Time: ${convertToBeijingTime(resultStart)}`,
        `End Time: ${convertToBeijingTime(resultEnd)}`
      ].join("\n");
    } else if (req.body && typeof req.body === 'string') {
      // 如果请求体是字符串，直接使用
      alertMessage = req.body.trim();
    } else {
      // 默认告警信息
      alertMessage = [
        'Search Name: 未指定',
        'Event Type: 未指定',
        'Search Type: 未指定',
        'Start Time: 未指定',
        'End Time: 未指定'
      ].join("\n");
    }
    
    // 构建消息对象（纯指定字段，无任何额外内容）
    const message = {
      msgtype: 'text',
      text: {
        content: alertMessage
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
