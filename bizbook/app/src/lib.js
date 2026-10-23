// "Today" uses the server's date (UTC) so it always matches the database rules.
// Next step: add a timezone setting per company.
export const today = () => new Date().toISOString().slice(0, 10)
export const money = (n, c = '$') => c + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const KINDS = { sale: 'Sale', expense: 'Expense', equipment: 'Equipment', stock: 'Stock bought' }
export const PRESETS = [
  { label: 'Car wash', unit: 'Cars washed', kinds: ['sale', 'expense', 'equipment'] },
  { label: 'Shop or retail', unit: null, kinds: ['sale', 'expense', 'stock'] },
  { label: 'Construction', unit: null, kinds: ['sale', 'expense'] },
  { label: 'Other service', unit: null, kinds: ['sale', 'expense'] },
]
export function compress(file) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 900 / img.width), c = document.createElement('canvas')
      c.width = img.width * k; c.height = img.height * k
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      c.toBlob(resolve, 'image/jpeg', 0.7)
    }
    img.src = URL.createObjectURL(file)
  })
}
