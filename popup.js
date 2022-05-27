import * as htmlparser2 from "htmlparser2";
const changeColor = document.getElementById("changeColor");
const docPwdEle = document.getElementById("docPwd");
let docNum = 0 // 文章总数
let curDocNum = 0 // 文章下载进度

changeColor.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const curUrl = tabs[0]?.url
        const url = new URL(curUrl)
        chrome.cookies.getAll({
            domain: url.hostname
        }, (cookies) => {
            handleGetAllDoc(cookies)
        })
    });
})

/**
 * @description: 获取所文章
 * @param {*} cookies
 * @return {*}
 */
async function handleGetAllDoc(cookies) {
    const { value } = cookies.find(v => v.name === 'Jwt-Token') || {}
    const headers = { 'Content-Type': 'application/json', 'jwt-token': value }
    const allPageRes = await fetchPost('https://api2.mubu.com/v3/api/list/get_all_documents_page', { start: '' }, headers)
    if (allPageRes.code === 0) {
        const foldersList = allPageRes.data.folders || []
        const docList = allPageRes.data.documents || []
        handleStartProgreess(docList.length)
        const allContentStr = await handleGetContent(foldersList, docList, headers)
        downloadFile(allContentStr, `幕布文章(共${docList.length}篇)`)
    }
}
/**
 * @description: 遍历文章组合文章内容
 * @param {*} foldersList
 * @param {*} docList
 * @param {*} headers
 * @return {*}
 */
async function handleGetContent(foldersList, docList, headers) {
    let allContentStr = '%% mubu_export\r\n'
    for (let i = 0; i < docList.length; i++) {
        try {
            const data = { docId: docList[i].id, password: docPwdEle.value || '' }
            const res = await fetchPost('https://api2.mubu.com/v3/api/document/edit/get', data, headers)
            if (res.code === 0) {
                const { name, definition } = res.data || {}
                const content = definition && JSON.parse(definition)
                const contentStr = handleGetContentItem(content.nodes)
                const folderNames = handleGetFolderName(foldersList, docList[i].folderId)
                allContentStr = `${allContentStr}---\r\n${folderNames}\r\n# ${name}\r\n${contentStr}`
            }
            curDocNum++
            handleEndProgreess(curDocNum)
        } catch (error) { error }
    }
    return allContentStr
}

/**
 * @description: 获取当前文章所属的各级文件夹名称
 * @param {*} foldersList
 * @param {*} folderId
 * @return {*}
 */
function handleGetFolderName(foldersList, folderId) {
    let folderNames = ''
    const deepFolderName = (folderId) => {
        const folderItem = foldersList.find(item => folderId === item.id)
        folderItem.name && (folderNames = `/${folderItem.name}${folderNames}`)
        if (folderItem.folderId !== '0') deepFolderName(folderItem.folderId)
    }
    if (folderId !== '0') deepFolderName(folderId)
    return `@我的文档${folderNames}`
}

/**
 * @description: 递归查询文本和图片
 * @param {*} contentNodes
 * @return {*}
 */
function handleGetContentItem(contentNodes) {
    let contentStr = ''
    const deepContent = (contentNodes, level = 0) => {
        contentNodes.forEach(item => {
            item.level = level
            const tabStr = ' '.repeat(level)
            const imagesStr = item.images ? item.images.map(t => `<img src="https://api2.mubu.com/v3/${t.uri}" />`).join('') : ''
            const noteStr = item.note ? `::${handleHtmlToMd(item.note.replace(/[\r\n]/, ''))}::` : ''
            const textStr = `${tabStr}- ${handleHtmlToMd(item.text)}${imagesStr}${noteStr}\r\n`;
            contentStr = `${contentStr}${textStr}`;
            if (item.children) deepContent(item.children, item.level + 1)
        })
    };
    deepContent(contentNodes)
    return contentStr
}

/**
 * @description: 处理html标签转化为md
 * @param {*} content
 * @return {*}
 */
function handleHtmlToMd(content) {
    let str = ''
    let isBold = false
    let isItalic = false
    let isStrikethrough = false
    let isCodespan = false
    const parser = new htmlparser2.Parser({
        onopentag(name, attr) {
            isBold = attr.class && attr.class.includes('bold')
            isItalic = attr.class && attr.class.includes('italic')
            isCodespan = attr.class && attr.class.includes('codespan')
            isStrikethrough = attr.class && attr.class.includes('strikethrough')
            str = str + `${isBold ? '**' : ''}`
            str = str + `${isItalic ? '*' : ''}`
            str = str + `${isStrikethrough ? '~~' : ''}`
            str = str + `${isCodespan ? '`' : ''}`
            if (name === 'a') str = str + `<a class="${attr.class}" href="${attr.href}">`
        },
        ontext(text) { str = str + text },
        onclosetag(tagname) {
            if (tagname === 'a') {
                str = str + `</a>`
                const classval = str.match(/<a class="(.*)" href/)[1]
                isBold = classval && classval.includes('bold')
                isItalic = classval && classval.includes('italic')
                isCodespan = classval && classval.includes('codespan')
                isStrikethrough = classval && classval.includes('strikethrough')
            }
            str = str + `${isCodespan ? '`' : ''}`
            str = str + `${isStrikethrough ? '~~' : ''}`
            str = str + `${isItalic ? '*' : ''}`
            str = str + `${isBold ? '**' : ''}`
            isBold = false;
            isItalic = false;
            isStrikethrough = false;
        },
    });
    parser.write(content);
    parser.end();
    return str && str.replace(/class=".*?"/, "")
}

/**
 * @description: 开始下载进度
 * @param {*} docListLength
 * @return {*}
 */
function handleStartProgreess(docListLength) {
    curDocNum = 0
    docNum = docListLength
    changeColor.setAttribute('disabled', true)
    changeColor.innerHTML = `文章正在下载中(${curDocNum}/${docNum})...`
}

/**
 * @description: 结束下载进度
 * @param {*} curDocNum
 * @return {*}
 */
function handleEndProgreess(curDocNum) {
    changeColor.innerHTML = `文章正在下载中(${curDocNum}/${docNum})...`
    if (curDocNum === docNum) {
        changeColor.removeAttribute('disabled')
        changeColor.innerHTML = '下载所有文章'
    }
}

/**
 * @description: 封装fetch的post方法
 * @param {*} url
 * @param {*} data
 * @param {*} headers
 * @param {*} method
 * @return {*}
 */
function fetchPost(url, data, headers, method = 'POST') {
    return new Promise((resolve, reject) => {
        fetch(url, { method, headers, body: JSON.stringify(data) })
            .then(response => response.json())
            .then(res => resolve(res))
            .catch(err => reject(err))
    })
}

/**
 * @description: 文件下载
 * @param {*} content
 * @param {*} filename
 * @return {*}
 */
function downloadFile(content, filename) {
    const blob = new Blob([content])
    var a = document.createElement("a")
    a.setAttribute("href", URL.createObjectURL(blob))
    a.setAttribute("download", `${filename}.txt`)
    a.setAttribute("target", "_blank")
    const clickEvent = document.createEvent("MouseEvents")
    clickEvent.initEvent("click", true, true);
    a.dispatchEvent(clickEvent);
}
