-- Export the current Neovim colour scheme as a Treelights theme file.
--
-- Run it with your own Neovim, after your colour scheme has loaded:
--   nvim --headless -c "luafile tools/export-nvim-theme.lua" \
--        -c "lua TreelightsExport('my-theme.json')" -c "qa!"
--
-- It reads every capture name used by the highlight queries Neovim has
-- for the listed languages, asks Neovim for the final colour and style
-- of each (following Neovim's own fallback from "@a.b.c" to "@a.b" to
-- "@a"), and writes them as plain data. Nothing else is recorded.

local LANGS = {
  "lua", "luadoc", "luap", "vim", "printf", "regex", "comment", "query",
  "python", "javascript", "ecma", "jsx", "typescript", "tsx", "bash", "c",
  "json", "markdown", "markdown_inline",
}

local function hex(n)
  return n and string.format("#%06x", n) or nil
end

local function style(name)
  local hl = vim.api.nvim_get_hl(0, { name = name, link = false })
  if vim.tbl_isempty(hl) then
    return nil
  end
  local s = {}
  s.fg = hex(hl.fg)
  s.bg = hex(hl.bg)
  if hl.bold then s.bold = true end
  if hl.italic then s.italic = true end
  if hl.underline then s.underline = true end
  if hl.undercurl then s.undercurl = true end
  if hl.strikethrough then s.strikethrough = true end
  return next(s) and s or nil
end

-- Neovim resolves "@a.b.c.lang" by trying the full name, then dropping
-- the last dotted part, down to "@a".
local function resolve(capture, lang)
  local parts = vim.split(capture, ".", { plain = true })
  for n = #parts, 1, -1 do
    local base = "@" .. table.concat(parts, ".", 1, n)
    local s = (lang ~= "" and style(base .. "." .. lang)) or style(base)
    if s then
      return s
    end
  end
  return nil
end

local function captures_for(lang)
  local names = {}
  for _, kind in ipairs({ "highlights", "injections" }) do
    for _, file in ipairs(vim.treesitter.query.get_files(lang, kind)) do
      for line in io.lines(file) do
        for name in line:gmatch("@([%w_][%w_.]*)") do
          if not name:match("^_") and not name:match("^injection") then
            names[name] = true
          end
        end
      end
    end
  end
  return names
end

function TreelightsExport(path)
  local normal = style("Normal") or {}
  local theme = {
    name = vim.g.colors_name or "neovim",
    type = vim.o.background,
    background = normal.bg,
    foreground = normal.fg,
    source = "Exported from Neovim " .. tostring(vim.version()),
    captures = {},
  }
  for _, lang in ipairs(LANGS) do
    for capture in pairs(captures_for(lang)) do
      local s = resolve(capture, lang)
      if s then
        local generic = resolve(capture, "")
        -- store the generic style once, and a language entry only where
        -- the language differs (for example "@tag.tsx")
        if theme.captures[capture] == nil and generic then
          theme.captures[capture] = generic
        end
        if not vim.deep_equal(s, theme.captures[capture]) then
          theme.captures[capture .. "." .. lang] = s
        end
      end
    end
  end
  local f = assert(io.open(path, "w"))
  f:write(vim.json.encode(theme))
  f:close()
end
