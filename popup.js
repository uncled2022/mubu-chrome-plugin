import * as htmlparser2 from "htmlparser2";
import { saveAs } from 'file-saver';
const JSZip = require("jszip");
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

// 获取所有文件夹和文档
async function handleGetAllDoc(cookies) {
    const { value } = cookies.find(v => v.name === 'Jwt-Token') || {}
    const headers = { 'Content-Type': 'application/json', 'jwt-token': value }
    const allPageRes = await fetchPost('https://api2.mubu.com/v3/api/list/get_all_documents_page', { start: '' }, headers)
    if (allPageRes.code === 0) handleListToTree(allPageRes.data, headers)
}

// 把返回的文件夹和文件转换成树形结构
function handleListToTree(data, headers) {
    const { root_relation = "[]", folders = [], documents = [] } = data || {};
    handleStartProgreess(documents.length)
    documents.forEach((item) => (item.type = "doc"));
    const folderDocList = [...documents, ...folders];
    const rootFolderList = handleSortRelation(folderDocList, root_relation, "0");
    handleDeepFolder(rootFolderList, folderDocList);
    handledownloadFile(rootFolderList, folders, documents, headers)
}

// 给文件夹添加子级
function handleDeepFolder(rootFolderList, folderDocList) {
    for (let i = 0; i < rootFolderList.length; i++) {
        const item = rootFolderList[i];
        const childrenList = handleSortRelation(folderDocList, item.relation, item.id);
        if (childrenList.length) {
            item.children = childrenList;
            handleDeepFolder(childrenList, folderDocList);
        }
    }
}

// 返回子级文件并根据relation排序
function handleSortRelation(folderDocList, relation, id) {
    let childrenList = folderDocList.filter((v) => v.folderId === id);
    const relations = relation && JSON.parse(relation);
    if (relation && relations.length) childrenList = relations.map((v) => childrenList.find((t) => t.id === v.id));
    return childrenList;
}

// 递归下载文件夹和文件
async function handledownloadFile(rootFolderList, folders, documents, headers) {
    const zip = new JSZip();
    zip.file(`使用说明.txt`, '1. 单篇文稿按照目录结构导出为单个txt文件\r\n2. 把需要导入到软件中的txt文件拖拽到软件中即可\r\n3. 由于图片是在线图片，导入到软件中会重新下载图片，请在联网的情况下导入\r\n4. 有时把txt文件拖到软件中会感觉没反应，请不要着急，等图片加载完之后就可以了');
    await handleDeepList(rootFolderList, folders, headers, zip)
    zip.generateAsync({ type: "blob" }).then(function (content) {
        saveAs(content, `幕布文章(共${documents.length}篇).zip`);
    });
}

// 递归文件夹下的文章
async function handleDeepList(rootFolderList, folders, headers, zip) {
    for (let i = 0; i < rootFolderList.length; i++) {
        const item = rootFolderList[i];
        if (item.type === "doc") {
            const folderNames = handleGetFolderName(folders, item.folderId);
            const allContentStr = await handleGetDocStr(item.id, folderNames, headers)
            const folder = zip.folder(folderNames);
            // 文件中过多图片情况处理
            const imagesList = (allContentStr && allContentStr.match(/<img\s+src=".*?"\s*\/>/gi)) || [];
            const fileName = imagesList.length > 100 ? `${item.name}(文件中图片数量超过100, 可能无法加载该文件).txt` : `${item.name}.txt`
            folder.file(fileName, allContentStr);
            curDocNum++
            handleEndProgreess(curDocNum)
        }
        if (item.children) await handleDeepList(item.children, folders, headers, zip)
    }
}

// 获取文章内容
async function handleGetDocStr(docId, folderNames, headers) {
    let allContentStr = '%% mubu_export\r\n'
    const data = { docId, password: docPwdEle.value || '' }
    const res = await fetchPost('https://api2.mubu.com/v3/api/document/edit/get', data, headers)
    if (res.code === 0) {
        const { name, definition } = res.data || {}
        const content = definition && JSON.parse(definition)
        const contentStr = handleGetContentItem(content.nodes)
        allContentStr = `${allContentStr}---\r\n${folderNames}\r\n# ${name}\r\n${contentStr}`
    } else if (res.code === 2003) {
        allContentStr = `${allContentStr}---\r\n此文章为加密文章，请输入密码后重新下载!!!`
    }
    return allContentStr
}

// 获取当前文章所属的各级文件夹名称
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

// 递归查询文本和图片
function handleGetContentItem(contentNodes = []) {
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

// 处理html标签转化为md
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

// 开始下载进度
function handleStartProgreess(docListLength) {
    curDocNum = 0
    docNum = docListLength
    changeColor.setAttribute('disabled', true)
    changeColor.innerHTML = `文章正在下载中(${curDocNum}/${docNum})...`
}

// 结束下载进度
function handleEndProgreess(curDocNum) {
    changeColor.innerHTML = `文章正在下载中(${curDocNum}/${docNum})...`
    if (curDocNum === docNum) {
        changeColor.removeAttribute('disabled')
        changeColor.innerHTML = '下载所有文章'
    }
}

// 封装fetch的post方法
function fetchPost(url, data, headers, method = 'POST') {
    return new Promise((resolve, reject) => {
        fetch(url, { method, headers, body: JSON.stringify(data) })
            .then(response => response.json())
            .then(res => resolve(res))
            .catch(err => reject(err))
    })
}