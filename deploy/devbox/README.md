# DevBox deployment

The live Paoding backend runs on `fenghongxin.123@10.37.197.49` and stores large assets on `/data00`.

- Checkout and recipe data: `~/Code/paoding`
- Text and vision model: Qwen3-VL 30B-A3B Instruct Q4_K_M
- Model files: `/data00/paoding/qwen3vl30b`
- Inference engine: `~/opt/llama.cpp/build/bin/llama-server`, compiled for AVX2 CPU execution
- OpenAI-compatible model endpoint: `http://127.0.0.1:11435/v1`
- Context window: `65536` tokens, single-request scheduling
- Whisper model: `~/Code/paoding/models/ggml-large-v3-turbo.bin`, using 16 CPU threads
- Public relay: reverse SSH from DevBox port `4177` to `124.221.36.36:14177`

`paoding-update.timer` polls GitHub `main`, runs the full Node test suite, restarts the app, waits for its local health check, and only then writes the deployed commit to `app/deploy-version.txt`. GitHub Actions verifies that exact commit marker through the public URL.

Install the checked-in units after provisioning dependencies:

```bash
mkdir -p ~/.config/systemd/user
mkdir -p ~/.local/bin
install -m 0644 deploy/devbox/paoding*.service deploy/devbox/paoding-update.timer ~/.config/systemd/user/
install -m 0755 deploy/devbox/update.sh ~/.local/bin/paoding-update
systemctl --user daemon-reload
systemctl --user enable --now paoding-llm.service paoding.service paoding-tunnel.service paoding-update.timer
```
