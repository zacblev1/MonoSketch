import http from 'http';

const API_URL = process.env.MONOSKETCH_API_URL || 'http://localhost:3100';

interface RequestOptions {
  method: string;
  path: string;
  body?: any;
}

export async function apiRequest(options: RequestOptions): Promise<any> {
  const url = new URL(options.path, API_URL);

  return new Promise((resolve, reject) => {
    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          try {
            const err = JSON.parse(data);
            reject(new Error(err.error || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
          return;
        }
        // For text/plain responses (render endpoint)
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('text/plain')) {
          resolve(data);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(
        `Cannot reach MonoSketch API at ${API_URL}. ` +
        `Start it with: cd api-server && npm start. Error: ${err.message}`
      ));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}
