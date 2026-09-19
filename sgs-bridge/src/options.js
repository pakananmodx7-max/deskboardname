const input = document.getElementById('sgs-keyword')
const saveBtn = document.getElementById('save')
const savedMessage = document.getElementById('saved-message')

async function load() {
  const { sgsKeyword } = await chrome.storage.local.get('sgsKeyword')
  input.value = sgsKeyword ?? 'sgs'
}

saveBtn.addEventListener('click', async () => {
  const value = input.value.trim().toLowerCase() || 'sgs'
  await chrome.storage.local.set({ sgsKeyword: value })
  savedMessage.hidden = false
  setTimeout(() => {
    savedMessage.hidden = true
  }, 1500)
})

void load()
