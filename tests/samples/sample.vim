" Vim script sample for Treelights tests (also the kind of code found in
" vim.cmd strings inside Lua)
set number relativenumber
let g:mapleader = " "
let s:count = 0

function! s:Greet(name) abort
  if a:name ==# ''
    echo "Hello, world"
  elseif len(a:name) > 10
    echom printf("Hello, %s!", a:name[0:9])
  else
    for l:i in range(1, 3)
      let s:count += l:i
    endfor
  endif
  return s:count
endfunction

augroup TreelightsSample
  autocmd!
  autocmd FileType python setlocal shiftwidth=4 expandtab
augroup END

nnoremap <silent> <leader>w :write<CR>
command! -nargs=? Greet call s:Greet(<q-args>)
vsplit | terminal ipython --no-autoindent
wincmd p
highlight Comment ctermfg=8 guifg=#828bb8 gui=italic
silent! colorscheme tokyonight-moon
