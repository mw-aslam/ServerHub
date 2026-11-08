module.exports = {
  apps: [
    {
      name: 'serverhub-agent',
      script: 'index.js',
      cwd: __dirname,
      node_args: '--max-old-space-size=48',
      max_memory_restart: '90M',
      autorestart: true,
      restart_delay: 5000,
      merge_logs: true,
    },
  ],
};
